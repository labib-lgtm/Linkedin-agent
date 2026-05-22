import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  searchCompany,
  getCompanyEmployees,
  type CompanyMatch,
  type EmployeeMatch,
} from "./lib/unipile.js";
import { fetchAmazonBrandName } from "./lib/amazon.js";
import { generateJson } from "./lib/openrouter.js";

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

// Sales Nav rate limits trip fast on LinkedIn's side (~250 searches/day on
// Standard tier). With ~10s pacing we stretch a 200-row import to ~50 min
// of wall-clock but stay well under per-minute thresholds. The 429 path
// below still handles a cap blow-up gracefully.
const PER_CALL_SLEEP_MS = 10_000;
// One cool-down breath after a 429 before bailing to manual retry.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
// Sales Navigator unlocks more than the 5 "featured employees" cap.
// 10 keeps API cost reasonable while covering founder + commerce/marketing
// leadership for typical Amazon seller brands.
const EMPLOYEES_PER_COMPANY = 10;

// Detect Unipile's rate-limit response. When this fires we keep the
// seller in 'pending' state (so a re-run picks it up) and bail the
// import gracefully — don't mark the import 'failed' which would block
// the operator's re-fire.
function isRateLimitError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  return /429|too_many_requests|too many requests|rate.limit/i.test(msg);
}

interface SellerRow {
  id: string;
  account_id: string;
  seller_name: string | null;
  business_name: string | null;
  brand_name: string | null;
  storefront_url: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  enrichment_status: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ensure we have a brand_name on the seller, scraping the Amazon
 *  storefront if we don't already. Cached on the row so subsequent
 *  enrichment runs skip the scrape. Returns the brand name (cached or
 *  freshly scraped) or null if the storefront didn't yield one. */
async function ensureBrandName(
  seller: SellerRow,
  client: ReturnType<typeof getServiceClient>,
): Promise<string | null> {
  if (seller.brand_name && seller.brand_name.trim().length > 0) {
    return seller.brand_name.trim();
  }
  if (!seller.storefront_url) return null;
  const scraped = await fetchAmazonBrandName(seller.storefront_url);
  if (scraped) {
    await client.from("sellers").update({ brand_name: scraped }).eq("id", seller.id);
    return scraped;
  }
  return null;
}

async function tryMatch(seller: SellerRow, brandName: string | null): Promise<CompanyMatch | null> {
  // Prefer the scraped brand name (specific, e.g. "BTween Girls Apparel")
  // over the CSV's legal entity names (often generic, e.g. "Between LLC")
  // which routinely match the wrong LinkedIn company.
  const candidates = [brandName, seller.seller_name, seller.business_name]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  for (const q of candidates) {
    try {
      const match = await searchCompany(q);
      if (match && (match.numericId !== null || match.url)) return match;
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

interface MatchVerdict {
  ok: boolean;
  reason: string;
}

// LLM gate between company-match and employee-fetch. LinkedIn's company
// search returns its top keyword hit regardless of whether it's actually
// the Amazon seller, so a generic name like "You Like We Supply" matches
// "Supply Chain Visions". This asks a cheap model to confirm the matched
// LinkedIn company really is the seller before we pull its employees.
//
// Fails OPEN: if the model errors/times out we keep the match (tagged as
// unverified) rather than discard a possibly-good match on a transient
// blip. The whole point is to cut obvious mismatches, not gate on uptime.
async function verifyCompanyMatch(
  seller: SellerRow,
  match: CompanyMatch,
): Promise<MatchVerdict> {
  const sellerLoc = [seller.city, seller.state].filter(Boolean).join(", ");
  const user = [
    "AMAZON SELLER",
    `  Brand / store name: ${seller.brand_name || seller.seller_name || "(unknown)"}`,
    `  Legal/business name: ${seller.business_name || "(unknown)"}`,
    `  Product category: ${seller.category || "(unknown)"}`,
    `  Location: ${sellerLoc || "(unknown)"}`,
    "",
    "LINKEDIN COMPANY (top search result)",
    `  Name: ${match.name || "(unknown)"}`,
    `  Industry: ${match.industry || "(unknown)"}`,
    `  Location: ${match.location || "(unknown)"}`,
    `  About: ${(match.summary || "(none)").slice(0, 300)}`,
    "",
    "Is this LinkedIn company the SAME business as the Amazon seller?",
  ].join("\n");

  try {
    const verdict = await generateJson<{ match: boolean; reason?: string }>({
      system:
        "You verify whether a LinkedIn company is the same business as an Amazon seller. " +
        "Amazon sellers are consumer-product brands (apparel, beauty, health, home, electronics, etc.). " +
        "Be STRICT. Answer false when: the names don't clearly correspond (sharing one generic word " +
        "like 'Supply', 'Wonder', 'Trade', 'Global' is NOT a match); the LinkedIn industry is incompatible " +
        "with selling physical consumer goods on Amazon (e.g. IT services, software, logistics, staffing, " +
        "consulting, marketing agency); or it's clearly a large unrelated corporation. Answer true only " +
        'when you are confident they are the same company. Output JSON {"match": boolean, "reason": string}.',
      user,
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    return { ok: verdict.match === true, reason: (verdict.reason ?? "").slice(0, 300) };
  } catch (e) {
    logger.warn("verifyCompanyMatch failed (failing open)", {
      seller_id: seller.id,
      error: String(e),
    });
    return { ok: true, reason: `unverified (LLM error: ${(e as Error).message})`.slice(0, 300) };
  }
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
      .select(
        "id, account_id, seller_name, business_name, brand_name, storefront_url, category, city, state, enrichment_status",
      )
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
      // Scrape the Amazon storefront brand name first (cached on the row
      // after first scrape). This is our most-specific LinkedIn query.
      const brandName = await ensureBrandName(seller, client);

      let match: CompanyMatch | null = null;
      try {
        match = await tryMatch(seller, brandName);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);

        // 429 rate limit — leave seller pending, cool down briefly, then
        // bail the import gracefully (status='queued' so the operator's
        // re-fire / next cron picks it up without manual reset).
        if (isRateLimitError(e)) {
          logger.warn("rate limit hit, pausing import", {
            seller_id: seller.id,
            error: msg,
            matched,
            no_match: noMatch,
          });
          await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
          await client
            .from("seller_imports")
            .update({
              status: "queued",
              error: `Paused at seller ${seller.seller_name ?? seller.id} after ${matched + noMatch} processed: ${msg.slice(0, 300)}`,
            })
            .eq("id", importId);
          return {
            ok: false,
            importId,
            matched,
            no_match: noMatch,
            failed,
            error: `rate_limited: ${msg}`,
          };
        }

        // Hard fail (auth, persistent 5xx) — bail the whole run so the
        // operator can fix the root cause before more rows burn.
        await client
          .from("sellers")
          .update({
            enrichment_status: "failed",
            enrichment_error: msg.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        failed += 1;
        await client
          .from("seller_imports")
          .update({ status: "failed", error: msg.slice(0, 500) })
          .eq("id", importId);
        return { ok: false, importId, matched, no_match: noMatch, failed, error: msg };
      }

      if (!match || (match.numericId === null && !match.url)) {
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

      // We store the numeric LinkedIn company ID (stringified) in
      // `linkedin_company_urn` to preserve the existing column shape,
      // even though it's not technically a URN. The Sales Nav people
      // filter `company.include` requires the bare integer.
      const numericId = match.numericId;
      const companyIdString = numericId !== null ? String(numericId) : null;
      const companyUrl = match.url ?? null;

      // Fetch employees. Requires the numeric company ID — if the match
      // came back without one (e.g. an exotic classic response shape), we
      // record the company match but skip the employees lookup.
      let employees: EmployeeMatch[] = [];
      if (numericId === null) {
        await client
          .from("sellers")
          .update({
            enrichment_status: "matched",
            linkedin_company_urn: null,
            linkedin_company_url: companyUrl,
            enrichment_error: "company match has no numeric ID; skipped employees lookup",
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        matched += 1;
        await sleep(PER_CALL_SLEEP_MS);
        continue;
      }

      // LLM gate: confirm the matched LinkedIn company is actually this
      // seller before spending a Sales Nav call + writing prospects.
      // Catches keyword-collision mismatches (e.g. "You Like We Supply"
      // → "Supply Chain Visions").
      const verdict = await verifyCompanyMatch(seller, match);
      if (!verdict.ok) {
        await client
          .from("sellers")
          .update({
            enrichment_status: "no_match",
            linkedin_company_urn: null,
            linkedin_company_url: null,
            enrichment_error: `rejected match "${match.name ?? "?"}": ${verdict.reason}`.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        noMatch += 1;
        logger.info("verification rejected match", {
          seller_id: seller.id,
          seller: seller.brand_name || seller.seller_name,
          rejected_company: match.name,
          reason: verdict.reason,
        });
        await sleep(PER_CALL_SLEEP_MS);
        continue;
      }

      try {
        employees = await getCompanyEmployees(numericId, EMPLOYEES_PER_COMPANY);
      } catch (e) {
        // 429 → keep seller pending (the company match we just stored
        // will be redone on retry, which is fine), cool down, bail.
        if (isRateLimitError(e)) {
          logger.warn("rate limit hit on employees lookup, pausing", {
            seller_id: seller.id,
            companyId: numericId,
            matched,
            no_match: noMatch,
          });
          await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
          await client
            .from("seller_imports")
            .update({
              status: "queued",
              error: `Paused at seller ${seller.seller_name ?? seller.id} after ${matched + noMatch} processed: ${(e as Error).message?.slice(0, 300)}`,
            })
            .eq("id", importId);
          return {
            ok: false,
            importId,
            matched,
            no_match: noMatch,
            failed,
            error: `rate_limited: ${(e as Error).message}`,
          };
        }
        logger.warn("getCompanyEmployees failed", {
          seller_id: seller.id,
          companyId: numericId,
          error: String(e),
        });
        // Treat as matched-but-no-employees rather than failing the whole
        // import — we still got the company match, the employees lookup
        // just didn't produce. Operator can manually browse from the
        // company URL.
        await client
          .from("sellers")
          .update({
            enrichment_status: "matched",
            linkedin_company_urn: companyIdString,
            linkedin_company_url: companyUrl,
            enrichment_error: `employees: ${(e as Error).message}`.slice(0, 5000),
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
          linkedin_company_urn: companyIdString,
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
