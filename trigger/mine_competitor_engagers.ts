import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  fetchPostComments,
  fetchPostReactions,
  commenterId,
  commenterName,
  getUserProfileLite,
} from "./lib/unipile.js";

/**
 * Mine competitor engagers → surface prospects for Tab 3 segments.
 *
 * For each active competitor, walk the last 30 days of their posts (up to
 * 20 posts to keep the run bounded), collect commenters + reactors, and
 * upsert into competitor_engagers. Runs the target_segments match join
 * inline so Tab 3's "prospect suggestions" query only needs a single
 * array containment operator, not a live match computation per row.
 *
 * Rate hygiene: Unipile's /posts/comments and /posts/reactions cost 1 call
 * each per post. 15 competitors × 20 posts × 2 endpoints = 600 calls per
 * run — paced at 1s each = 10 min of wall clock. Well within the 30 min
 * maxDuration.
 *
 * Deep enrichment (industry / current_company / job_title via
 * getUserProfileLite) is done only for engagers that appear NEW to the
 * table — repeat engagers use their cached row. Keeps a large re-engager
 * event volume cheap.
 */

const PER_CALL_SLEEP_MS = 1_000;
const POSTS_PER_COMPETITOR = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fires on-demand from Tab 4's "Mine engagers now" button. Was designed as
// a daily 05:30 UTC cron; kept as plain task while we're at the schedule
// limit. Restore the cron once dashboard schedules are freed.
export const mineCompetitorEngagers = task({
  id: "mine-competitor-engagers",
  maxDuration: 30 * 60,
  run: async (_payload: Record<string, never>, { ctx }) => {
    const client = getServiceClient();

    // Only competitors we track for this loop — exclude the "self" flag rows
    // and archived ones.
    const { data: competitors, error: cErr } = await client
      .from("competitors")
      .select("id, account_id, provider_id, identifier, name")
      .eq("is_self", false)
      .is("archived_at", null);
    if (cErr) {
      logger.error("mine-engagers: competitors fetch failed", { error: cErr.message });
      throw cErr;
    }
    if (!competitors || competitors.length === 0) return { ok: true, engagers_upserted: 0 };

    // Load target_segments per account so the inline segment-match join can
    // compute matched_segment_ids on write.
    const segmentsByAccount = new Map<string, Segment[]>();
    for (const acctId of new Set(competitors.map((c) => c.account_id as string))) {
      const { data: segs } = await client
        .from("target_segments")
        .select("id, industries, role_keywords, locations")
        .eq("account_id", acctId)
        .is("archived_at", null);
      segmentsByAccount.set(acctId, (segs ?? []) as Segment[]);
    }

    let upserted = 0;
    let deepEnrichments = 0;
    let errors = 0;

    for (const comp of competitors) {
      // Fetch most recent posts for this competitor.
      const { data: posts, error: pErr } = await client
        .from("competitor_posts")
        .select("post_id, urn, posted_at")
        .eq("competitor_id", comp.id)
        .order("posted_at", { ascending: false })
        .limit(POSTS_PER_COMPETITOR);
      if (pErr) {
        errors += 1;
        logger.warn("mine-engagers: posts fetch failed", {
          competitor_id: comp.id,
          error: pErr.message,
        });
        continue;
      }

      const segments = segmentsByAccount.get(comp.account_id as string) ?? [];

      for (const post of posts ?? []) {
        const targetId = (post.urn as string | null) || (post.post_id as string);
        if (!targetId) continue;

        // Comments
        try {
          await sleep(PER_CALL_SLEEP_MS);
          const comments = await fetchPostComments(targetId);
          for (const c of comments) {
            const pid = commenterId(c);
            if (!pid) continue;
            const enriched = await upsertEngager(client, {
              accountId: comp.account_id as string,
              competitorId: comp.id as string,
              provider_id: pid,
              full_name: commenterName(c),
              headline: null,
              profile_url:
                (c.author_details?.profile_url as string | undefined) ?? null,
              signal_type: "comment",
              first_post_id: targetId,
              segments,
            });
            if (enriched === "upserted") upserted += 1;
            if (enriched === "deep") deepEnrichments += 1;
          }
        } catch (e) {
          errors += 1;
          logger.warn("mine-engagers: comments fetch failed", {
            competitor_id: comp.id,
            post_id: targetId,
            error: (e as Error).message,
          });
        }

        // Reactions
        try {
          await sleep(PER_CALL_SLEEP_MS);
          const reactions = await fetchPostReactions(targetId);
          for (const r of reactions) {
            if (!r.provider_id) continue;
            const enriched = await upsertEngager(client, {
              accountId: comp.account_id as string,
              competitorId: comp.id as string,
              provider_id: r.provider_id,
              full_name: r.full_name,
              headline: r.headline,
              profile_url: r.profile_url,
              signal_type: "reaction",
              first_post_id: targetId,
              segments,
            });
            if (enriched === "upserted") upserted += 1;
            if (enriched === "deep") deepEnrichments += 1;
          }
        } catch (e) {
          errors += 1;
          logger.warn("mine-engagers: reactions fetch failed", {
            competitor_id: comp.id,
            post_id: targetId,
            error: (e as Error).message,
          });
        }
      }
    }

    logger.info("mine-engagers done", {
      runId: ctx.run.id,
      competitors: competitors.length,
      engagers_upserted: upserted,
      deep_enrichments: deepEnrichments,
      errors,
    });
    return { ok: true, upserted, deepEnrichments, errors };
  },
});

interface Segment {
  id: string;
  industries: string[];
  role_keywords: string[];
  locations: string[];
}

async function upsertEngager(
  client: ReturnType<typeof getServiceClient>,
  args: {
    accountId: string;
    competitorId: string;
    provider_id: string;
    full_name: string | null;
    headline: string | null;
    profile_url: string | null;
    signal_type: "comment" | "reaction";
    first_post_id: string;
    segments: Segment[];
  },
): Promise<"upserted" | "deep" | "skipped"> {
  // Look up existing row to decide whether we need a deep enrichment call.
  const { data: existing } = await client
    .from("competitor_engagers")
    .select("id, signal_type, industry, job_title, location")
    .eq("account_id", args.accountId)
    .eq("competitor_id", args.competitorId)
    .eq("provider_id", args.provider_id)
    .maybeSingle();

  // Only fetch full profile if the row is new — repeat engagers keep cached fields.
  let industry: string | null = existing?.industry ?? null;
  let job_title: string | null = existing?.job_title ?? null;
  let current_company: string | null = null;
  let location: string | null = existing?.location ?? null;
  let city: string | null = null;
  let country: string | null = null;
  let outcome: "upserted" | "deep" = "upserted";

  if (!existing) {
    try {
      const p = await getUserProfileLite(args.provider_id);
      if (p) {
        industry = p.industry;
        job_title = p.job_title;
        current_company = p.current_company;
        location = p.location;
        city = p.city;
        country = p.country;
        outcome = "deep";
      }
    } catch {
      // Non-fatal — engager row still gets written with just the signal.
    }
  }

  // Compute segment matches inline. AND across categories, OR within array.
  const matched: string[] = [];
  for (const seg of args.segments) {
    const industryHit =
      seg.industries.length === 0 || (industry != null && seg.industries.some((i) => industry!.toLowerCase().includes(i.toLowerCase())));
    const roleHit =
      seg.role_keywords.length === 0 ||
      seg.role_keywords.some((rk) => {
        const rkL = rk.toLowerCase();
        return (
          (job_title != null && job_title.toLowerCase().includes(rkL)) ||
          (args.headline != null && args.headline.toLowerCase().includes(rkL))
        );
      });
    const locHit =
      seg.locations.length === 0 ||
      (location != null && seg.locations.some((l) => location!.toLowerCase().includes(l.toLowerCase())));
    if (industryHit && roleHit && locHit) matched.push(seg.id);
  }

  // Merge signal_type — if existing was "comment" and we're logging a
  // "reaction" now, promote to "both". Same the other way.
  let signal_type: "comment" | "reaction" | "both" = args.signal_type;
  if (existing && existing.signal_type && existing.signal_type !== args.signal_type) {
    signal_type = "both";
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await client
    .from("competitor_engagers")
    .upsert(
      {
        account_id: args.accountId,
        competitor_id: args.competitorId,
        provider_id: args.provider_id,
        full_name: args.full_name,
        headline: args.headline,
        location,
        city,
        country,
        industry,
        current_company,
        job_title,
        profile_url: args.profile_url,
        signal_type,
        first_post_id: existing ? undefined : args.first_post_id,
        last_seen_at: nowIso,
        matched_segment_ids: matched,
      },
      { onConflict: "account_id,competitor_id,provider_id" },
    );
  if (upErr) return "skipped";
  return outcome;
}
