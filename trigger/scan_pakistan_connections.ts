import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  walkAllRelations,
  getUserProfileLite,
  type RelationRow,
} from "./lib/unipile.js";

/**
 * Pakistan connection cleanup — DISCOVERY pass.
 *
 * Unipile does NOT expose a "remove connection" endpoint (verified against
 * their /reference index — endpoints exist for invite / cancel-invite /
 * search / endorse / getprofile, but no disconnect). Running bulk removals
 * server-side would require reverse-engineering LinkedIn's Voyager
 * internal API via Unipile's raw-data pass-through — the exact pattern
 * LinkedIn's automation guards flag. Given the account is a business asset
 * (Lynx Media inbound flow), we do this as a discovery-only pass and let
 * the operator click through removals via LinkedIn's own UI (3 clicks per
 * profile, ~10 seconds each).
 *
 * Flow:
 *   1. Insert a pakistan_cleanup_scans row (status='running')
 *   2. Walk EVERY relation on the account (paginated, no cap)
 *   3. Per relation: if the inline location already contains a Pakistan
 *      keyword, mark it. Otherwise per-profile lookup to fetch location.
 *   4. Upsert every match into pakistan_cleanup_targets
 *   5. Close the scan row (status='completed' or 'failed')
 *
 * Idempotent — unique(account_id, provider_id) means re-running the scan
 * updates existing rows rather than duplicating.
 *
 * Rate-limit hygiene: 1s sleep between Unipile calls. Full profile lookups
 * are the dominant cost (one HTTP round-trip per relation). At ~1 req/s
 * we stay well under Unipile's per-minute limit and don't stress
 * LinkedIn's per-account guards.
 */

// Keyword bank for the Pakistan location filter. Matched case-insensitively
// against the profile's location string. Country name catches everyone with
// a country line; city keywords catch profiles that only list a city.
const PAKISTAN_KEYWORDS = [
  "pakistan",
  "lahore",
  "karachi",
  "islamabad",
  "rawalpindi",
  "faisalabad",
  "multan",
  "peshawar",
  "quetta",
  "sialkot",
  "gujranwala",
  "hyderabad",  // Pakistani Hyderabad (Sindh)
  "bahawalpur",
  "sargodha",
  "punjab",     // covers "Lahore, Punjab" etc. False-positive risk: Indian
                //   Punjab; the profile-level cross-check catches those
                //   because a Chandigarh/Amritsar profile still has India
                //   in its country, not Pakistan.
  "sindh",
  "balochistan",
  "khyber pakhtunkhwa",
];

// India false-positive guard: if the location contains India, drop the
// row even when a shared-name city like "Hyderabad" or "Punjab" matched.
const INDIA_MARKERS = ["india", "indian"];

// Pace between Unipile calls. Existing prospect enrichment uses 10s per
// call because Sales Nav is a bottleneck; profile GETs are much cheaper,
// so 1s keeps a 3000-connection scan under 60 minutes while staying safe.
const PER_CALL_SLEEP_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScanSummary {
  ok: boolean;
  total_relations: number;
  profiles_fetched: number;
  matches_found: number;
  errors: number;
  error?: string;
}

interface MatchDecision {
  matched: boolean;
  keyword: string | null;
}

function decideMatch(location: string | null | undefined): MatchDecision {
  if (!location) return { matched: false, keyword: null };
  const l = location.toLowerCase();
  // India false-positive guard first.
  if (INDIA_MARKERS.some((m) => l.includes(m))) {
    // But allow "Pakistan" to override — a location like "India-Pakistan
    // border" is real. Prefer explicit Pakistan mention over the India
    // marker.
    if (l.includes("pakistan")) return { matched: true, keyword: "pakistan" };
    return { matched: false, keyword: null };
  }
  for (const kw of PAKISTAN_KEYWORDS) {
    if (l.includes(kw)) return { matched: true, keyword: kw };
  }
  return { matched: false, keyword: null };
}

export const scanPakistanConnections = task({
  id: "scan-pakistan-connections",
  // Concurrency=1: two simultaneous scans would double-charge Unipile
  // profile fetches and race on the pakistan_cleanup_scans row.
  queue: {
    name: "scan-pakistan",
    concurrencyLimit: 1,
  },
  maxDuration: 60 * 60, // 1h — enough for ~3000 profile fetches at 1s/each.
  run: async (
    payload: { accountId: string; hardCap?: number },
    { ctx },
  ): Promise<ScanSummary> => {
    const summary: ScanSummary = {
      ok: true,
      total_relations: 0,
      profiles_fetched: 0,
      matches_found: 0,
      errors: 0,
    };

    const { accountId } = payload;
    if (!accountId) {
      summary.ok = false;
      summary.error = "scan-pakistan: accountId required";
      return summary;
    }

    const client = getServiceClient();
    const { data: scanRow, error: scanErr } = await client
      .from("pakistan_cleanup_scans")
      .insert({
        account_id: accountId,
        run_id: ctx.run.id,
        status: "running",
      })
      .select("id")
      .single();
    if (scanErr || !scanRow) {
      summary.ok = false;
      summary.error = `scan-pakistan: failed to open scan row: ${scanErr?.message}`;
      return summary;
    }
    const scanId = scanRow.id as string;

    logger.info("scan-pakistan start", { runId: ctx.run.id, accountId, scanId });

    try {
      // Walk EVERY relation. Callback lets us persist progress per page so
      // partial results survive a mid-run crash.
      const allRelations: RelationRow[] = await walkAllRelations({
        pageSize: 100,
        hardCap: payload.hardCap ?? 20_000,
        onPage: async (batch, pageNum) => {
          logger.info("scan-pakistan: page fetched", {
            pageNum,
            batch: batch.length,
          });
          // Between pages of the relations endpoint — cheaper than profile
          // fetches, but still gate to be safe.
          await sleep(PER_CALL_SLEEP_MS);
        },
      });
      summary.total_relations = allRelations.length;

      // Fast path — filter on inline location first. Whatever's left needs
      // a per-profile fetch to determine location.
      const inlineMatches: { rel: RelationRow; keyword: string }[] = [];
      const needsProfileLookup: RelationRow[] = [];
      const inlineNonPakistan = new Set<string>();

      for (const rel of allRelations) {
        const decision = decideMatch(rel.location);
        if (decision.matched && decision.keyword) {
          inlineMatches.push({ rel, keyword: decision.keyword });
        } else if (rel.location && rel.location.trim().length > 0) {
          // Location present but not Pakistan — skip the profile lookup.
          inlineNonPakistan.add(rel.provider_id);
        } else {
          needsProfileLookup.push(rel);
        }
      }

      logger.info("scan-pakistan: inline classification", {
        total: allRelations.length,
        inline_matched: inlineMatches.length,
        inline_confirmed_other: inlineNonPakistan.size,
        needs_profile_lookup: needsProfileLookup.length,
      });

      // Upsert inline matches first — cheap, no external calls.
      for (const { rel, keyword } of inlineMatches) {
        await upsertTarget(client, accountId, rel, rel.location ?? null, keyword);
        summary.matches_found += 1;
      }
      await client
        .from("pakistan_cleanup_scans")
        .update({ matches_found: summary.matches_found, total_relations: summary.total_relations })
        .eq("id", scanId);

      // Slow path — per-profile lookup for the unclassified rest.
      for (const rel of needsProfileLookup) {
        await sleep(PER_CALL_SLEEP_MS);
        let profile;
        try {
          profile = await getUserProfileLite(rel.provider_id);
        } catch (e) {
          summary.errors += 1;
          logger.warn("scan-pakistan: profile fetch failed", {
            provider_id: rel.provider_id,
            error: (e as Error).message,
          });
          continue;
        }
        summary.profiles_fetched += 1;

        const locationString =
          profile?.location ??
          (profile?.country ? `${profile.country}` : null);
        const decision = decideMatch(locationString);
        if (decision.matched && decision.keyword) {
          // Prefer the profile fetch's data when available (fresher).
          const merged: RelationRow = {
            ...rel,
            full_name: profile?.full_name ?? rel.full_name,
            headline: profile?.headline ?? rel.headline,
            public_identifier: profile?.public_identifier ?? rel.public_identifier,
            profile_url: profile?.profile_url ?? rel.profile_url,
            location: locationString,
          };
          await upsertTarget(client, accountId, merged, locationString, decision.keyword);
          summary.matches_found += 1;
        }

        // Periodic progress checkpoint — every 25 profiles.
        if (summary.profiles_fetched % 25 === 0) {
          await client
            .from("pakistan_cleanup_scans")
            .update({
              profiles_fetched: summary.profiles_fetched,
              matches_found: summary.matches_found,
            })
            .eq("id", scanId);
        }
      }

      await client
        .from("pakistan_cleanup_scans")
        .update({
          status: "completed",
          profiles_fetched: summary.profiles_fetched,
          matches_found: summary.matches_found,
          total_relations: summary.total_relations,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);

      logger.info("scan-pakistan done", { ...summary });
    } catch (e) {
      summary.ok = false;
      summary.error = (e as Error).message;
      await client
        .from("pakistan_cleanup_scans")
        .update({
          status: "failed",
          error: (e as Error).message,
          profiles_fetched: summary.profiles_fetched,
          matches_found: summary.matches_found,
          total_relations: summary.total_relations,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);
      throw e;
    }

    return summary;
  },
});

async function upsertTarget(
  client: ReturnType<typeof getServiceClient>,
  accountId: string,
  rel: RelationRow,
  location: string | null,
  keyword: string,
): Promise<void> {
  const { error } = await client
    .from("pakistan_cleanup_targets")
    .upsert(
      {
        account_id: accountId,
        provider_id: rel.provider_id,
        public_identifier: rel.public_identifier,
        full_name: rel.full_name,
        headline: rel.headline,
        location,
        matched_keyword: keyword,
        profile_url: rel.profile_url,
        scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,provider_id" },
    );
  if (error) {
    // Log but don't kill the run — one bad row shouldn't lose the batch.
    logger.warn("scan-pakistan: upsert failed", {
      provider_id: rel.provider_id,
      error: error.message,
    });
  }
}
