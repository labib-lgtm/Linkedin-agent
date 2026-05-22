import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  searchCompanies,
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
 * upload. Loops the import's seller rows, runs:
 *   1. ensureBrandName — scrape the Amazon storefront for the real brand
 *      display name (cached on the row); our most-specific LinkedIn query.
 *   2. gatherCandidates — search LinkedIn for the top 5 companies by name.
 *   3. selectBestMatch — LLM picks the correct candidate among same-name
 *      collisions (by industry + location), or rejects all → no_match.
 *   4. getCompanyEmployees — Sales Nav people search for the chosen company.
 *   5. filterDecisionMakers — LLM drops ambassadors / non-decision-makers.
 *   6. Upsert survivors into prospects (unique on seller_id+provider_id),
 *      mark seller matched / no_match / failed, bump enriched_count.
 *
 * Pacing: ~10s between Unipile calls. 200 rows ≈ ~50 min — inside the 1h
 * maxDuration. 429s pause the import gracefully (status='queued'); other
 * hard errors fail the run so the operator can fix the root cause.
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

// Collect candidate LinkedIn companies for a seller. Tries the scraped
// brand name first (specific, e.g. "BTween Girls Apparel"), then the CSV's
// legal names. Returns the candidate set from the FIRST query that yields
// usable results — top 5, so the selector can disambiguate same-name
// collisions (e.g. two different "Arc Solutions"). Throws on hard
// auth/rate-limit failures so they aren't masked as no_match.
async function gatherCandidates(
  seller: SellerRow,
  brandName: string | null,
): Promise<CompanyMatch[]> {
  const queries = [brandName, seller.seller_name, seller.business_name]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  for (const q of queries) {
    try {
      const results = await searchCompanies(q, 5);
      const usable = results.filter((c) => c.numericId !== null || c.url);
      if (usable.length > 0) return usable;
    } catch (e) {
      logger.warn("searchCompanies failed", { seller_id: seller.id, query: q, error: String(e) });
      throw e;
    }
    await sleep(PER_CALL_SLEEP_MS);
  }
  return [];
}

interface MatchSelection {
  match: CompanyMatch | null;
  reason: string;
}

// LLM selector between company-search and employee-fetch. Given the seller
// and several candidate LinkedIn companies (names collide — "Arc Solutions"
// returns both a consulting firm and the welding manufacturer), pick the
// ONE that's actually the seller, using industry + location to
// disambiguate, or reject all.
//
// Fails OPEN to the top candidate: if the model errors/times out we keep
// result #1 (tagged unverified) rather than discard a possibly-good match
// on a transient blip.
async function selectBestMatch(
  seller: SellerRow,
  candidates: CompanyMatch[],
): Promise<MatchSelection> {
  if (candidates.length === 0) return { match: null, reason: "no candidates" };
  const sellerLoc = [seller.city, seller.state].filter(Boolean).join(", ");
  const list = candidates
    .map(
      (c, i) =>
        `${i}. ${c.name || "(no name)"} | industry: ${c.industry || "?"} | location: ${c.location || "?"} | about: ${(c.summary || "").slice(0, 140)}`,
    )
    .join("\n");
  const user = [
    "AMAZON SELLER",
    `  Brand / store name: ${seller.brand_name || seller.seller_name || "(unknown)"}`,
    `  Legal/business name: ${seller.business_name || "(unknown)"}`,
    `  Product category: ${seller.category || "(unknown)"}`,
    `  Location: ${sellerLoc || "(unknown)"}`,
    "",
    "CANDIDATE LINKEDIN COMPANIES",
    list,
    "",
    "Pick the index of the ONE candidate that is the same business as this Amazon seller, or -1 if none qualify.",
  ].join("\n");

  try {
    const res = await generateJson<{ index: number; reason?: string }>({
      model: "moonshotai/kimi-k2.5",
      system:
        "You match a small Amazon consumer-product seller (apparel, beauty, health, supplements, " +
        "home, kitchen, electronics, accessories, automotive parts, etc.) to the correct LinkedIn " +
        "company from a numbered candidate list. Several candidates may share a name — use industry, " +
        "location, and description to pick the RIGHT one.\n\n" +
        "Pick a candidate's index ONLY if its DISTINCTIVE brand name clearly corresponds to the seller " +
        "AND it plausibly makes/sells physical consumer products. Location is a strong signal — Amazon " +
        "sellers usually match their HQ city/state.\n\n" +
        "Return -1 (no match) if none qualify, including when candidates only share a generic word, " +
        "abbreviation, or initials with the seller (e.g. 'Beverly Hills MD' vs 'MD Anderson Cancer " +
        "Center'; 'You Like We Supply' vs 'Supply Chain Visions'), or are institutions / service " +
        "businesses (hospitals, universities, government, finance, IT, logistics, staffing, consulting, " +
        "agencies) or large well-known organizations. When uncertain, return -1.\n\n" +
        'Output JSON {"index": <number>, "reason": <string>}.',
      user,
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const idx = res.index;
    if (typeof idx === "number" && idx >= 0 && idx < candidates.length) {
      return { match: candidates[idx], reason: (res.reason ?? "").slice(0, 300) };
    }
    return { match: null, reason: (res.reason ?? "no candidate matched").slice(0, 300) };
  } catch (e) {
    logger.warn("selectBestMatch failed (falling back to top candidate)", {
      seller_id: seller.id,
      error: String(e),
    });
    return {
      match: candidates[0],
      reason: `unverified (LLM error: ${(e as Error).message})`.slice(0, 300),
    };
  }
}

// Second LLM pass — screen the people Sales Nav returned for a (verified)
// company down to genuine current decision-makers. The company filter
// includes brand ambassadors, UGC creators, freelancers, and people whose
// real job is elsewhere; this drops them. One batched call per company.
//
// Fails OPEN on error (keep all). When the model returns a valid verdict
// we respect it even if it keeps none — "right company, no decision-makers
// among the returned set" is an accurate outcome, not a bug.
async function filterDecisionMakers(
  companyName: string,
  industry: string | undefined,
  employees: EmployeeMatch[],
): Promise<EmployeeMatch[]> {
  if (employees.length === 0) return employees;
  const list = employees
    .map((e, i) => `${i}. ${e.name ?? "(no name)"} — ${e.headline ?? "(no headline)"}`)
    .join("\n");
  try {
    const res = await generateJson<{ keep: number[] }>({
      model: "moonshotai/kimi-k2.5",
      system:
        "You screen LinkedIn people returned for a company, keeping only genuine current " +
        "decision-makers actually EMPLOYED there. KEEP: founders, owners, CEO/CMO/COO/CGO and other " +
        "C-level, presidents, VPs, and heads/directors/managers of marketing, ecommerce, growth, " +
        "brand, or operations whose role is clearly at the target company. REMOVE: brand ambassadors, " +
        "'biggest fan' / UGC creators / influencers, freelancers and contractors, agency staff, and " +
        "anyone whose headline shows their primary role is a DIFFERENT company. When unsure, remove. " +
        'Output JSON {"keep": [<indices of people to keep>]}.',
      user: `Target company: ${companyName}${industry ? ` (${industry})` : ""}\n\nPeople:\n${list}`,
      temperature: 0,
      maxTokens: 200,
      timeoutMs: 12_000,
    });
    const keepSet = new Set((res.keep ?? []).filter((n) => Number.isInteger(n) && n >= 0));
    return employees.filter((_, i) => keepSet.has(i));
  } catch (e) {
    logger.warn("filterDecisionMakers failed (keeping all)", {
      companyName,
      error: String(e),
    });
    return employees;
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

      let candidates: CompanyMatch[] = [];
      try {
        candidates = await gatherCandidates(seller, brandName);
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

      // No company candidates at all → no_match.
      if (candidates.length === 0) {
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

      // LLM picks the right candidate among same-name collisions (or
      // rejects all). Replaces blind trust in LinkedIn's #1 result —
      // "Arc Solutions" returns both a consulting firm and the welding
      // manufacturer that's the actual seller.
      const selection = await selectBestMatch(seller, candidates);
      const match = selection.match;
      if (!match) {
        await client
          .from("sellers")
          .update({
            enrichment_status: "no_match",
            linkedin_company_urn: null,
            linkedin_company_url: null,
            enrichment_error: `no candidate matched (${candidates.length} considered): ${selection.reason}`.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", seller.id);
        noMatch += 1;
        logger.info("selection rejected all candidates", {
          seller_id: seller.id,
          seller: seller.brand_name || seller.seller_name,
          candidates: candidates.map((c) => c.name),
          reason: selection.reason,
        });
        await sleep(PER_CALL_SLEEP_MS);
        continue;
      }

      // We store the numeric LinkedIn company ID (stringified) in
      // `linkedin_company_urn` to preserve the existing column shape,
      // even though it's not technically a URN. The Sales Nav people
      // filter `company.include` requires the bare integer.
      const numericId = match.numericId;
      const companyIdString = numericId !== null ? String(numericId) : null;
      const companyUrl = match.url ?? null;

      // Fetch employees. Requires the numeric company ID — if the chosen
      // candidate came back without one (e.g. an exotic classic response
      // shape), record the company match but skip the employees lookup.
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

      // Second LLM pass: screen the returned people. Sales Nav's company
      // filter includes ambassadors / UGC creators / contractors who list
      // the brand but aren't decision-makers. Keep only genuine ones.
      employees = await filterDecisionMakers(
        match.name || brandName || seller.seller_name || "",
        match.industry,
        employees,
      );

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
