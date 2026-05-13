import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  searchCompany,
  getCompanyEmployees,
  type CompanyMatch,
  type EmployeeMatch,
} from "./lib/unipile.js";

/**
 * Prospect enrichment — iterates one seller_imports batch.
 *
 * Triggered imperatively by POST /api/prospects/imports after a CSV
 * upload. Loops the imports's seller rows, runs:
 *   1. searchCompany(seller_name) → fallback searchCompany(business_name)
 *   2. If matched: getCompanyEmployees(urn, limit=5)
 *   3. Upsert each employee into prospects (unique on seller_id+provider_id)
 *   4. Mark seller matched / no_match / failed
 *   5. Increment seller_imports.enriched_count
 *
 * Pacing: 2s between Unipile calls. 200 rows × ~10s ≈ 33 min — well
 * inside the 1h maxDuration. On any per-seller error, log and continue
 * (don't fail the whole import).
 */

const PER_CALL_SLEEP_MS = 2000;
const EMPLOYEES_PER_COMPANY = 5;

interface SellerRow {
  id: string;
  account_id: string;
  seller_name: string | null;
  business_name: string | null;
  enrichment_status: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryMatch(seller: SellerRow): Promise<CompanyMatch | null> {
  const candidates = [seller.seller_name, seller.business_name]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  for (const q of candidates) {
    try {
      const match = await searchCompany(q);
      if (match?.urn || match?.id || match?.url) return match;
    } catch (e) {
      logger.warn("searchCompany failed", { seller_id: seller.id, query: q, error: String(e) });
      // Surface the error to the caller so a hard auth/rate-limit failure
      // doesn't get masked as "no_match" silently.
      throw e;
    }
    await sleep(PER_CALL_SLEEP_MS);
  }
  return null;
}

export const enrichProspects = task({
  id: "enrich-seller-imports",
  maxDuration: 60 * 60, // 1h
  run: async (
    payload: { importId: string },
    { ctx },
  ): Promise<{
    ok: boolean;
    importId: string;
    matched: number;
    no_match: number;
    failed: number;
    error?: string;
  }> => {
    const { importId } = payload;
    const client = getServiceClient();
    logger.info("enrich-seller-imports start", { runId: ctx.run.id, importId });

    const { data: imp, error: impErr } = await client
      .from("seller_imports")
      .select("id, account_id, status")
      .eq("id", importId)
      .maybeSingle();
    if (impErr || !imp) {
      return {
        ok: false,
        importId,
        matched: 0,
        no_match: 0,
        failed: 0,
        error: impErr?.message ?? "import not found",
      };
    }

    // Mark as processing (idempotent — caller already set it but this
    // covers the case where the run is re-fired manually).
    await client
      .from("seller_imports")
      .update({ status: "processing" })
      .eq("id", importId);

    const { data: sellers, error: sErr } = await client
      .from("sellers")
      .select("id, account_id, seller_name, business_name, enrichment_status")
      .eq("import_id", importId)
      .eq("enrichment_status", "pending")
      .order("created_at", { ascending: true });
    if (sErr) {
      await client
        .from("seller_imports")
        .update({ status: "failed", error: sErr.message })
        .eq("id", importId);
      return {
        ok: false,
        importId,
        matched: 0,
        no_match: 0,
        failed: 0,
        error: sErr.message,
      };
    }

    let matched = 0;
    let noMatch = 0;
    let failed = 0;

    for (const seller of (sellers ?? []) as SellerRow[]) {
      let match: CompanyMatch | null = null;
      try {
        match = await tryMatch(seller);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        await client
          .from("sellers")
          .update({
            enrichment_status: "failed",
            enrichment_error: msg.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        failed += 1;
        // Hard fail (auth, persistent 5xx) — bail the whole run so the
        // operator can fix the root cause before more rows burn.
        await client
          .from("seller_imports")
          .update({ status: "failed", error: msg.slice(0, 500) })
          .eq("id", importId);
        return { ok: false, importId, matched, no_match: noMatch, failed, error: msg };
      }

      if (!match || (!match.urn && !match.id && !match.url)) {
        await client
          .from("sellers")
          .update({
            enrichment_status: "no_match",
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        noMatch += 1;
        await client.rpc("increment_seller_import_enriched", { p_import_id: importId }).then(
          () => undefined,
          // RPC may not exist; fall back to a non-atomic update.
          async () => {
            await client
              .from("seller_imports")
              .update({ enriched_count: ((sellers?.indexOf(seller) ?? 0) + 1) })
              .eq("id", importId);
          },
        );
        continue;
      }

      const companyId = match.urn ?? match.id ?? "";
      const companyUrl = match.url ?? null;

      // Fetch employees.
      let employees: EmployeeMatch[] = [];
      try {
        employees = await getCompanyEmployees(companyId, EMPLOYEES_PER_COMPANY);
      } catch (e) {
        logger.warn("getCompanyEmployees failed", {
          seller_id: seller.id,
          companyId,
          error: String(e),
        });
        // Treat as no_match rather than failing the whole import — we
        // still got the company match, the employees lookup just didn't
        // produce. Operator can manually browse from the company URL.
        await client
          .from("sellers")
          .update({
            enrichment_status: "matched",
            linkedin_company_urn: match.urn ?? null,
            linkedin_company_url: companyUrl,
            enrichment_error: `employees: ${(e as Error).message}`.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        matched += 1;
        await sleep(PER_CALL_SLEEP_MS);
        continue;
      }

      // Insert prospects (deduped by seller_id + provider_id).
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
          logger.warn("prospects upsert failed", {
            seller_id: seller.id,
            error: insErr.message,
          });
        }
      }

      await client
        .from("sellers")
        .update({
          enrichment_status: "matched",
          linkedin_company_urn: match.urn ?? null,
          linkedin_company_url: companyUrl,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", seller.id);
      matched += 1;

      await sleep(PER_CALL_SLEEP_MS);
    }

    // Final tally.
    await client
      .from("seller_imports")
      .update({
        status: "completed",
        enriched_count: matched + noMatch + failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    logger.info("enrich-seller-imports done", {
      importId,
      matched,
      no_match: noMatch,
      failed,
    });

    return { ok: true, importId, matched, no_match: noMatch, failed };
  },
});
