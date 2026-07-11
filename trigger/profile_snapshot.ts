import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { fetchProfile, fetchAndHashCover, hammingHex, normalizedCharDistance } from "./lib/profile.js";

/**
 * Daily profile snapshot — Phase 3 of Compare v2.
 *
 * Loops over every active competitor across every non-archived account,
 * pulls their LinkedIn profile via Unipile, hashes the cover image, and
 * compares against the most recent prior snapshot. Detected changes
 * (headline, cover, follower milestones) write to profile_change_events
 * which the InsightBanner + side-by-side compare modal consume.
 *
 * Runs at 5am UTC daily (before the digest cron at 8am UTC Mondays).
 *
 * Required env vars (set in Trigger.dev project Environment Variables):
 *   UNIPILE_API_KEY
 *   UNIPILE_DSN
 *   UNIPILE_LINKEDIN_ACCOUNT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const COVER_HAMMING_THRESHOLD = 10;        // bits differing → flagged as cover change
const HEADLINE_DISTANCE_THRESHOLD = 0.15;  // normalized char distance
const FOLLOWER_MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];
const STORAGE_BUCKET = "competitor-covers";

type CompetitorRow = {
  id: string;
  identifier: string;
  provider_id: string | null;
  account_id: string;
  is_self: boolean;
};

type SnapshotRow = {
  competitor_id: string;
  captured_at: string;
  headline: string | null;
  cover_blockhash: string | null;
  followers_count: number | null;
};

const supabase = getServiceClient;

async function uploadThumb(
  client: ReturnType<typeof supabase>,
  competitorId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const path = `${competitorId}/${Date.now()}.${ext(contentType)}`;
  const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) {
    logger.warn("cover upload failed", { competitorId, error: error.message });
    return null;
  }
  return path;
}

function ext(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

async function processCompetitor(
  client: ReturnType<typeof supabase>,
  c: CompetitorRow,
): Promise<{ ok: boolean; events: number; reason?: string }> {
  // Use cached provider_id when available; fall back to the slug.
  const lookup = c.provider_id || c.identifier;
  let profile: Awaited<ReturnType<typeof fetchProfile>>;
  try {
    profile = await fetchProfile(lookup);
  } catch (e) {
    return { ok: false, events: 0, reason: `unipile: ${(e as Error).message}` };
  }

  // Cache the resolved provider_id for future runs.
  if (!c.provider_id && profile.provider_id) {
    await client
      .from("competitors")
      .update({ provider_id: profile.provider_id })
      .eq("id", c.id);
  }

  // Hash + upload cover. Skip on failure rather than aborting the snapshot.
  let coverHash: string | null = null;
  let coverThumbPath: string | null = null;
  if (profile.cover_url) {
    const hashed = await fetchAndHashCover(profile.cover_url);
    if (hashed) {
      coverHash = hashed.hash;
      coverThumbPath = await uploadThumb(client, c.id, hashed.thumbnailBytes, hashed.contentType);
    }
  }

  // Pull the most recent prior snapshot to diff against.
  const { data: prior } = await client
    .from("competitor_snapshots")
    .select("competitor_id, captured_at, headline, cover_blockhash, followers_count")
    .eq("competitor_id", c.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle<SnapshotRow>();

  // Insert the new snapshot. We don't enforce one-per-day at the schema
  // layer (Postgres can't index a timestamptz::date cast — STABLE not
  // IMMUTABLE) so the worker just inserts. Multiple rows per day are
  // tolerable; queries pick the most recent via ORDER BY captured_at
  // DESC LIMIT 1.
  const today = new Date().toISOString();
  const { error: snapErr } = await client.from("competitor_snapshots").insert({
    competitor_id: c.id,
    account_id: c.account_id,
    captured_at: today,
    headline: profile.headline,
    cover_url: profile.cover_url,
    cover_blockhash: coverHash,
    cover_thumb_path: coverThumbPath,
    picture_url: profile.picture_url,
    followers_count: profile.followers_count,
    connections_count: profile.connections_count,
    raw_profile: profile.raw,
  });
  if (snapErr) {
    return { ok: false, events: 0, reason: `snapshot insert: ${snapErr.message}` };
  }

  // Diff against prior. New competitors (no prior) emit no events.
  let events = 0;
  if (prior) {
    const eventsBatch: Array<{
      competitor_id: string;
      account_id: string;
      kind: "headline" | "cover" | "followers_milestone";
      before_value: string | null;
      after_value: string | null;
      diff_score: number;
    }> = [];

    if (
      prior.headline &&
      profile.headline &&
      prior.headline !== profile.headline
    ) {
      const dist = normalizedCharDistance(prior.headline, profile.headline);
      if (dist >= HEADLINE_DISTANCE_THRESHOLD) {
        eventsBatch.push({
          competitor_id: c.id,
          account_id: c.account_id,
          kind: "headline",
          before_value: prior.headline,
          after_value: profile.headline,
          diff_score: dist,
        });
      }
    }

    if (prior.cover_blockhash && coverHash) {
      const dist = hammingHex(prior.cover_blockhash, coverHash);
      if (dist >= COVER_HAMMING_THRESHOLD) {
        eventsBatch.push({
          competitor_id: c.id,
          account_id: c.account_id,
          kind: "cover",
          before_value: prior.cover_blockhash,
          after_value: coverHash,
          diff_score: dist,
        });
      }
    }

    if (
      typeof prior.followers_count === "number" &&
      typeof profile.followers_count === "number"
    ) {
      for (const m of FOLLOWER_MILESTONES) {
        if (prior.followers_count < m && profile.followers_count >= m) {
          eventsBatch.push({
            competitor_id: c.id,
            account_id: c.account_id,
            kind: "followers_milestone",
            before_value: String(prior.followers_count),
            after_value: String(profile.followers_count),
            diff_score: m,
          });
        }
      }
    }

    if (eventsBatch.length > 0) {
      const { error: evErr } = await client.from("profile_change_events").insert(eventsBatch);
      if (evErr) {
        logger.warn("change events insert failed", { competitorId: c.id, error: evErr.message });
      } else {
        events = eventsBatch.length;
      }
    }
  }

  return { ok: true, events };
}

// TEMP: cron demoted to plain task because we're at Trigger.dev's 10/10
// schedule cap. Restore the cron (`cron: "0 5 * * *"` under schedules.task)
// after deleting the 4 stale schedules (daily-analyze-posts,
// monitor-post-comments, send-outbound-comments, weekly-client-report)
// from the Trigger.dev dashboard.
export const dailyProfileSnapshot = task({
  id: "daily-profile-snapshot",
  maxDuration: 60 * 30,
  run: async (_payload: Record<string, never>, { ctx }) => {
    const client = supabase();

    const { data: competitors, error } = await client
      .from("competitors")
      .select("id, identifier, provider_id, account_id, is_self")
      .eq("active", true);
    if (error) {
      throw new Error(`competitors fetch: ${error.message}`);
    }

    logger.info("starting snapshot run", {
      runId: ctx.run.id,
      competitor_count: competitors?.length ?? 0,
    });

    const summary = {
      processed: 0,
      ok: 0,
      failed: 0,
      total_events: 0,
      errors: [] as Array<{ id: string; reason: string }>,
    };

    for (const c of (competitors ?? []) as CompetitorRow[]) {
      summary.processed += 1;
      const result = await processCompetitor(client, c);
      if (result.ok) {
        summary.ok += 1;
        summary.total_events += result.events;
      } else {
        summary.failed += 1;
        summary.errors.push({ id: c.id, reason: result.reason ?? "unknown" });
      }
      // Be polite — Unipile rate-limits hard if we hammer.
      await new Promise((r) => setTimeout(r, 500));
    }

    logger.info("snapshot run complete", summary);
    return summary;
  },
});
