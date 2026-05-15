import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { getCompanyEmployees, type EmployeeMatch } from "./lib/unipile.js";

/**
 * Employees-only refetch — re-runs ONLY the Sales Nav people lookup for
 * sellers that already have a `linkedin_company_urn` stored (i.e. their
 * company match is good, we just need to retry the employees call after
 * a wrapper fix). Skips company search entirely.
 *
 * Used when the company-match step is known-good but the employees step
 * was broken (Unipile body shape iterations). Faster than a full
 * re-enrich because we save the 1 Unipile call per seller for company
 * discovery.
 *
 * Pacing + 429 handling mirrors enrich-seller-imports.
 */

const PER_CALL_SLEEP_MS = 10_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const EMPLOYEES_PER_COMPANY = 10;

function isRateLimitError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  return /429|too_many_requests|too many requests|rate.limit/i.test(msg);
}

interface MatchedSellerRow {
  id: string;
  account_id: string;
  seller_name: string | null;
  linkedin_company_urn: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse the numeric company ID out of whatever's in linkedin_company_urn.
 *  We've stored both pure numerics ("103848457") and (historically) URN
 *  strings ("urn:li:fs_salesCompany:103848457"). Handle both. */
function parseCompanyId(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m = trimmed.match(/:(\d+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export const refetchEmployees = task({
  id: "refetch-company-employees",
  maxDuration: 60 * 60,
  run: async (
    payload: { importId: string },
    { ctx },
  ): Promise<{
    ok: boolean;
    importId: string;
    processed: number;
    skipped: number;
    failed: number;
    error?: string;
  }> => {
    const { importId } = payload;
    const client = getServiceClient();
    logger.info("refetch-company-employees start", { runId: ctx.run.id, importId });

    await client
      .from("seller_imports")
      .update({ status: "processing", error: null })
      .eq("id", importId);

    const { data: sellers, error: sErr } = await client
      .from("sellers")
      .select("id, account_id, seller_name, linkedin_company_urn")
      .eq("import_id", importId)
      .eq("enrichment_status", "matched")
      .not("linkedin_company_urn", "is", null)
      .order("created_at", { ascending: true });
    if (sErr) {
      await client
        .from("seller_imports")
        .update({ status: "failed", error: sErr.message })
        .eq("id", importId);
      return { ok: false, importId, processed: 0, skipped: 0, failed: 0, error: sErr.message };
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const seller of (sellers ?? []) as MatchedSellerRow[]) {
      const numericId = parseCompanyId(seller.linkedin_company_urn);
      if (numericId === null) {
        logger.warn("could not parse numeric company id", {
          seller_id: seller.id,
          raw: seller.linkedin_company_urn,
        });
        skipped += 1;
        continue;
      }

      let employees: EmployeeMatch[] = [];
      try {
        employees = await getCompanyEmployees(numericId, EMPLOYEES_PER_COMPANY);
      } catch (e) {
        if (isRateLimitError(e)) {
          logger.warn("rate limit hit during refetch, pausing", {
            seller_id: seller.id,
            companyId: numericId,
            processed,
          });
          await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
          await client
            .from("seller_imports")
            .update({
              status: "queued",
              error: `Refetch paused at seller ${seller.seller_name ?? seller.id} after ${processed} processed: ${(e as Error).message?.slice(0, 300)}`,
            })
            .eq("id", importId);
          return {
            ok: false,
            importId,
            processed,
            skipped,
            failed,
            error: `rate_limited: ${(e as Error).message}`,
          };
        }
        logger.warn("getCompanyEmployees failed (refetch)", {
          seller_id: seller.id,
          companyId: numericId,
          error: String(e),
        });
        await client
          .from("sellers")
          .update({
            enrichment_error: `employees: ${(e as Error).message}`.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        failed += 1;
        await sleep(PER_CALL_SLEEP_MS);
        continue;
      }

      const rows = employees
        .filter((e) => e.provider_id || e.profile_url || e.name)
        .map((e) => ({
          seller_id: seller.id,
          account_id: seller.account_id,
          name: e.name ?? null,
          headline: e.headline ?? null,
          linkedin_url: e.profile_url ?? null,
          provider_id: e.provider_id ?? null,
          status: "new" as const,
        }));

      if (rows.length > 0) {
        const { error: insErr } = await client
          .from("prospects")
          .upsert(rows, { onConflict: "seller_id,provider_id", ignoreDuplicates: true });
        if (insErr) {
          logger.warn("prospects upsert failed (refetch)", {
            seller_id: seller.id,
            error: insErr.message,
          });
        }
      }

      // Clear the stale enrichment_error from the prior broken run.
      await client
        .from("sellers")
        .update({
          enrichment_error: null,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", seller.id);
      processed += 1;

      await sleep(PER_CALL_SLEEP_MS);
    }

    await client
      .from("seller_imports")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    logger.info("refetch-company-employees done", { importId, processed, skipped, failed });
    return { ok: true, importId, processed, skipped, failed };
  },
});
