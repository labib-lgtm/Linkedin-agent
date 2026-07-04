import { logger, task } from "@trigger.dev/sdk/v3";
import {
  walkAllRelations,
  getUserProfileLite,
  type RelationRow,
} from "./lib/unipile.js";

/**
 * One-off discovery task — no DB writes, no UI.
 *
 * Walks every LinkedIn connection, filters by Pakistan location keywords,
 * returns the full match list inline. Sibling of scan-pakistan-connections
 * but skips the pakistan_cleanup_targets / pakistan_cleanup_scans tables so
 * it runs before migration 029 is applied. Useful for a first look at
 * "how many would be affected" without touching the DB.
 *
 * Returns { total_relations, matches: PakistanMatch[] } where matches has
 * everything needed to open + review each profile.
 */

const PAKISTAN_KEYWORDS = [
  "pakistan", "lahore", "karachi", "islamabad", "rawalpindi", "faisalabad",
  "multan", "peshawar", "quetta", "sialkot", "gujranwala", "hyderabad",
  "bahawalpur", "sargodha", "punjab", "sindh", "balochistan",
  "khyber pakhtunkhwa",
];

const INDIA_MARKERS = ["india", "indian"];

const PER_CALL_SLEEP_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PakistanMatch {
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  matched_keyword: string;
  profile_url: string | null;
}

interface ListSummary {
  ok: boolean;
  total_relations: number;
  profiles_fetched: number;
  errors: number;
  match_count: number;
  matches: PakistanMatch[];
  error?: string;
}

function decideMatch(location: string | null | undefined): { matched: boolean; keyword: string | null } {
  if (!location) return { matched: false, keyword: null };
  const l = location.toLowerCase();
  if (INDIA_MARKERS.some((m) => l.includes(m))) {
    if (l.includes("pakistan")) return { matched: true, keyword: "pakistan" };
    return { matched: false, keyword: null };
  }
  for (const kw of PAKISTAN_KEYWORDS) {
    if (l.includes(kw)) return { matched: true, keyword: kw };
  }
  return { matched: false, keyword: null };
}

export const listPakistanConnections = task({
  id: "list-pakistan-connections",
  queue: { name: "list-pakistan", concurrencyLimit: 1 },
  maxDuration: 60 * 60,
  run: async (payload: { hardCap?: number }): Promise<ListSummary> => {
    const summary: ListSummary = {
      ok: true,
      total_relations: 0,
      profiles_fetched: 0,
      errors: 0,
      match_count: 0,
      matches: [],
    };

    try {
      const relations: RelationRow[] = await walkAllRelations({
        pageSize: 100,
        hardCap: payload.hardCap ?? 20_000,
      });
      summary.total_relations = relations.length;

      // Inline location classification first — free.
      const needsLookup: RelationRow[] = [];
      for (const rel of relations) {
        const decision = decideMatch(rel.location);
        if (decision.matched && decision.keyword) {
          summary.matches.push({
            provider_id: rel.provider_id,
            public_identifier: rel.public_identifier,
            full_name: rel.full_name,
            headline: rel.headline,
            location: rel.location,
            matched_keyword: decision.keyword,
            profile_url: rel.profile_url,
          });
        } else if (!rel.location || rel.location.trim().length === 0) {
          needsLookup.push(rel);
        }
        // else: location present but not Pakistan → skip lookup entirely.
      }

      logger.info("list-pakistan: after inline pass", {
        total: relations.length,
        inline_matches: summary.matches.length,
        needs_lookup: needsLookup.length,
      });

      // Per-profile lookup for the unclassified rest.
      for (const rel of needsLookup) {
        await sleep(PER_CALL_SLEEP_MS);
        let profile;
        try {
          profile = await getUserProfileLite(rel.provider_id);
        } catch (e) {
          summary.errors += 1;
          logger.warn("list-pakistan: profile fetch failed", {
            provider_id: rel.provider_id,
            error: (e as Error).message,
          });
          continue;
        }
        summary.profiles_fetched += 1;

        const location = profile?.location ?? profile?.country ?? null;
        const decision = decideMatch(location);
        if (decision.matched && decision.keyword) {
          summary.matches.push({
            provider_id: rel.provider_id,
            public_identifier: profile?.public_identifier ?? rel.public_identifier,
            full_name: profile?.full_name ?? rel.full_name,
            headline: profile?.headline ?? rel.headline,
            location,
            matched_keyword: decision.keyword,
            profile_url: profile?.profile_url ?? rel.profile_url,
          });
        }

        if (summary.profiles_fetched % 25 === 0) {
          logger.info("list-pakistan: progress", {
            fetched: summary.profiles_fetched,
            matches: summary.matches.length,
          });
        }
      }
      summary.match_count = summary.matches.length;
      logger.info("list-pakistan done", {
        total: summary.total_relations,
        fetched: summary.profiles_fetched,
        matches: summary.match_count,
      });
    } catch (e) {
      summary.ok = false;
      summary.error = (e as Error).message;
    }

    return summary;
  },
});
