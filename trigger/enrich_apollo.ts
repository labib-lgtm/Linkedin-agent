import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  searchOrganization,
  searchPeopleAtCompany,
  enrichPerson,
  rateLimitPause,
  ApolloError,
} from "./lib/apollo.js";

// Hard ceiling per run as a safety net so a misconfigured trigger can't
// drain the entire Apollo credit balance.
const ABSOLUTE_BUDGET_CAP = 500;

interface RunSummary {
  ok: boolean;
  checked: number;
  has_employees: number;
  no_employees: number;
  no_org_match: number;
  enriched: number;
  no_decision_maker: number;
  errors: number;
  credits_spent: number;
  error?: string;
}

/**
 * Apollo enrichment task.
 *
 * Per-seller flow with the three-tier credit ladder:
 *   1. Look up the seller row in sellers; check apollo_filter_status
 *      — short-circuit if we've already classified it as a dead end
 *   2. searchOrganization (FREE)  → if no match, mark 'no_org_match'
 *   3. searchPeopleAtCompany (FREE) → if no decision-maker match, mark 'no_employees'
 *   4. enrichPerson (1 CREDIT)    → upsert apollo_prospects, mark 'enriched'
 *
 * Triggered from the webapp /api/outreach/apollo/enrich route with a
 * resolved list of sellerIds + a credit budget cap. The worker never
 * recomputes the filter — it just iterates the list it was handed.
 */
export const enrichApolloSellers = task({
  id: "enrich-apollo-sellers",
  maxDuration: 60 * 60, // 1h
  run: async (
    payload: { sellerIds: string[]; budget?: number },
    { ctx },
  ): Promise<RunSummary> => {
    const { sellerIds } = payload;
    const budget = Math.max(0, Math.min(payload.budget ?? 200, ABSOLUTE_BUDGET_CAP));

    const summary: RunSummary = {
      ok: true,
      checked: 0,
      has_employees: 0,
      no_employees: 0,
      no_org_match: 0,
      enriched: 0,
      no_decision_maker: 0,
      errors: 0,
      credits_spent: 0,
    };

    if (!sellerIds || sellerIds.length === 0) {
      logger.info("enrich-apollo: no sellerIds supplied", { runId: ctx.run.id });
      return summary;
    }

    logger.info("enrich-apollo start", {
      runId: ctx.run.id,
      sellerCount: sellerIds.length,
      budget,
    });

    const client = getServiceClient();

    for (const sellerId of sellerIds) {
      if (summary.credits_spent >= budget) {
        logger.info("enrich-apollo: budget reached, stopping", {
          credits_spent: summary.credits_spent,
          budget,
        });
        break;
      }
      summary.checked += 1;

      try {
        const { data: seller, error: sErr } = await client
          .from("sellers")
          .select(
            "id, account_id, brand_name, business_name, seller_name, linkedin_company_url, storefront_url, apollo_filter_status",
          )
          .eq("id", sellerId)
          .maybeSingle();
        if (sErr || !seller) {
          summary.errors += 1;
          logger.warn("enrich-apollo: seller fetch failed", {
            sellerId,
            error: sErr?.message ?? "not found",
          });
          continue;
        }

        // Short-circuit if we already decided this seller's fate.
        if (
          seller.apollo_filter_status === "enriched" ||
          seller.apollo_filter_status === "no_org_match" ||
          seller.apollo_filter_status === "no_employees"
        ) {
          continue;
        }

        const linkedinUrl = (seller.linkedin_company_url as string | null) ?? "";
        if (!linkedinUrl) {
          await markStatus(client, sellerId, "no_org_match", null);
          summary.no_org_match += 1;
          continue;
        }

        // Tier 1 — FREE org lookup
        await rateLimitPause();
        const org = await searchOrganization(linkedinUrl);
        if (!org) {
          await markStatus(client, sellerId, "no_org_match", null);
          summary.no_org_match += 1;
          continue;
        }
        const empCount = org.estimated_num_employees ?? 0;
        if (empCount === 0) {
          await markStatus(client, sellerId, "no_employees", 0);
          summary.no_employees += 1;
          continue;
        }
        // Persist the org-level info before moving on, so we keep state
        // even if a later step throws.
        await markStatus(client, sellerId, "has_employees", empCount);
        summary.has_employees += 1;

        // Tier 2 — FREE people lookup at the matched org
        await rateLimitPause();
        const person = await searchPeopleAtCompany(org.id);
        if (!person) {
          await markStatus(client, sellerId, "no_employees", empCount);
          summary.no_decision_maker += 1;
          continue;
        }

        // Tier 3 — 1 CREDIT person enrichment
        await rateLimitPause();
        const enriched = await enrichPerson(person.id);
        if (!enriched) {
          summary.errors += 1;
          logger.warn("enrich-apollo: person/match returned nothing", {
            sellerId,
            personId: person.id,
          });
          continue;
        }
        summary.credits_spent += 1;

        // Upsert the prospect record.
        const { error: upErr } = await client
          .from("apollo_prospects")
          .upsert(
            {
              seller_id: sellerId,
              account_id: seller.account_id,
              apollo_person_id: enriched.id,
              apollo_organization_id: enriched.organization_id ?? org.id,
              name: enriched.name,
              first_name: enriched.first_name,
              last_name: enriched.last_name,
              title: enriched.title,
              seniority: enriched.seniority,
              email: enriched.email,
              email_status: enriched.email_status,
              phone: enriched.phone,
              linkedin_profile_url: enriched.linkedin_url,
              city: enriched.city,
              state: enriched.state,
              country: enriched.country,
              company_linkedin_url: linkedinUrl,
              amazon_storefront_url: seller.storefront_url ?? null,
              raw: enriched.raw,
              enriched_at: new Date().toISOString(),
            },
            { onConflict: "seller_id,apollo_person_id" },
          );
        if (upErr) {
          summary.errors += 1;
          logger.warn("enrich-apollo: apollo_prospects upsert failed", {
            sellerId,
            error: upErr.message,
          });
          continue;
        }

        await markStatus(client, sellerId, "enriched", empCount);
        summary.enriched += 1;
      } catch (e) {
        summary.errors += 1;
        if (e instanceof ApolloError) {
          logger.warn("enrich-apollo: Apollo call failed", {
            sellerId,
            status: e.status,
            message: e.message,
          });
          // 401/403 means the key is wrong — bail out of the whole run.
          if (e.status === 401 || e.status === 403) {
            summary.ok = false;
            summary.error = `Apollo auth failed (${e.status}). Check APOLLO_API_KEY in Trigger.dev env.`;
            await markStatus(client, sellerId, "failed", null);
            break;
          }
        } else {
          logger.warn("enrich-apollo: unexpected error", {
            sellerId,
            error: (e as Error).message,
          });
        }
        await markStatus(client, sellerId, "failed", null);
      }
    }

    logger.info("enrich-apollo done", { ...summary });
    return summary;
  },
});

async function markStatus(
  client: ReturnType<typeof getServiceClient>,
  sellerId: string,
  status:
    | "pending"
    | "has_employees"
    | "no_employees"
    | "no_org_match"
    | "enriched"
    | "failed",
  employeeCount: number | null,
): Promise<void> {
  const update: Record<string, unknown> = {
    apollo_filter_status: status,
    apollo_filter_checked_at: new Date().toISOString(),
  };
  if (employeeCount !== null) update.apollo_employee_count = employeeCount;
  await client.from("sellers").update(update).eq("id", sellerId);
}
