import { logger, task, tasks } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  commenterId,
  commenterName,
  commentId,
  commentText,
  fetchPostComments,
  type UnipileComment,
} from "./lib/unipile.js";

/**
 * Phase F (production scheduler) — comment monitor.
 *
 * Every 5 minutes, scan published posts <24h old that have a CTA keyword
 * configured. For each, fetch comments via Unipile, dedupe against
 * lead_magnet_recipients, and fire the cta-comment-response engagement
 * loop on any new keyword match.
 *
 * Replaces the manual CLI tools/unipile_monitor_comments.py — that script
 * still works for ad-hoc testing but is no longer in the production path.
 *
 * Required Trigger.dev project env vars (already set for engagement_loop):
 *   UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_LINKEDIN_ACCOUNT_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const POLL_WINDOW_HOURS = 24;
const MAX_ANGLES_PER_RUN = 30;
const PACING_MS_BETWEEN_FETCHES = 250;

// Match the angle.cta_keyword against a comment's text.
//   1. Exact word-boundary match, case-insensitive (the strict path).
//   2. For keywords ≥6 chars, ALSO accept any whole word within edit
//      distance 1 (1 insertion / deletion / substitution). Catches the
//      common typo classes: 'Thresold', 'Threshhold', 'Treshold'.
//      The 6-char floor stops short keywords like 'KILL' from
//      matching innocuous words like 'kell', 'bill', 'kil'.
function withinDistanceOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i++;
      j++; // substitution
    } else if (a.length > b.length) {
      i++; // delete from a
    } else {
      j++; // delete from b == insert into a
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function matchesCta(text: string, ctaKeyword: string): boolean {
  if (!ctaKeyword) return false;
  const escaped = ctaKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return true;
  // Fuzzy fallback: only for longer keywords, only on alphabetic tokens.
  if (ctaKeyword.length < 6) return false;
  const lower = ctaKeyword.toLowerCase();
  const words = text.toLowerCase().match(/[a-z]+/g);
  if (!words) return false;
  return words.some((w) => withinDistanceOne(w, lower));
}

// Extract a Unipile-friendly post identifier from a published_media_urn or
// post_url. Both shapes are seen in the angles table depending on the
// publish path.
function postIdFrom(urn: string | null, url: string | null): string | null {
  for (const candidate of [urn, url]) {
    if (!candidate) continue;
    const urnMatch = candidate.match(/urn:li:[a-zA-Z]+:\d+/);
    if (urnMatch) return urnMatch[0];
    const numericMatch = candidate.match(/\/(\d{15,25})\/?/);
    if (numericMatch) return numericMatch[1];
    // urn:li:share:1234... passed bare (without the protocol prefix)
    const bare = candidate.match(/^urn:li:[a-zA-Z]+:\d+$/);
    if (bare) return bare[0];
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ActiveAngleRow {
  angle_id: string;
  post_url: string | null;
  published_media_urn: string | null;
  cta_keyword: string | null;
  lead_magnet_url: string | null;
  account_id: string | null;
}

// Cron disabled — Audience pivot (2026-07). Task remains callable manually
// but no longer fires on schedule.
export const monitorPostComments = task({
  id: "monitor-post-comments",
  // Worst case: 30 angles × 1s Unipile fetch + 250ms pacing + a few
  // trigger.dev fan-outs. Should finish well inside 5 minutes.
  maxDuration: 60 * 4,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    logger.info("monitor-post-comments cycle start", { runId: ctx.run.id });

    const cutoff = new Date(
      Date.now() - POLL_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Pull active angles. We treat anything with status IN (Posted,Reviewed)
    // and date_posted in the last 24h that has a CTA keyword + a post URL
    // as eligible.
    const { data: angles, error: aErr } = await client
      .from("angles")
      .select("angle_id, post_url, published_media_urn, cta_keyword, lead_magnet_url, account_id, status, date_posted")
      .in("status", ["Posted", "Reviewed"])
      .gte("date_posted", cutoff)
      .not("cta_keyword", "is", null)
      .order("date_posted", { ascending: false })
      .limit(MAX_ANGLES_PER_RUN);
    if (aErr) {
      logger.error("angles fetch failed", { error: aErr.message });
      return { scanned: 0, fired: 0, error: aErr.message };
    }

    const active = (angles ?? []) as ActiveAngleRow[];
    logger.info("active posts in window", { count: active.length, windowHours: POLL_WINDOW_HOURS });

    let scanned = 0;
    let firedTotal = 0;
    let dedupSkipped = 0;
    let noKeywordHits = 0;

    for (const angle of active) {
      const postId = postIdFrom(angle.published_media_urn, angle.post_url);
      if (!postId) {
        logger.warn("could not extract post id", { angle_id: angle.angle_id });
        continue;
      }
      const cta = (angle.cta_keyword ?? "").trim();
      if (!cta) continue;

      let comments: UnipileComment[];
      try {
        comments = await fetchPostComments(postId);
      } catch (e) {
        logger.warn("fetchPostComments failed", {
          angle_id: angle.angle_id,
          post_id: postId,
          error: String(e),
        });
        continue;
      }
      scanned += 1;

      // Pre-load existing recipient comment_ids for this angle so we
      // dedupe in one query rather than per-comment.
      const { data: existing } = await client
        .from("lead_magnet_recipients")
        .select("comment_id")
        .eq("angle_id", angle.angle_id);
      const seen = new Set(
        (existing ?? [])
          .map((r) => (r.comment_id as string | null) ?? "")
          .filter(Boolean),
      );

      for (const c of comments) {
        const cid = commentId(c);
        if (!cid) continue;
        if (seen.has(cid)) {
          dedupSkipped += 1;
          continue;
        }
        const body = commentText(c);
        if (!matchesCta(body, cta)) {
          noKeywordHits += 1;
          continue;
        }

        // Fire the engagement loop. Insert the recipient row first so we
        // never lose track of the comment if the trigger call fails.
        const cName = commenterName(c);
        const cUid = commenterId(c);
        let recipientId: string | null = null;
        try {
          const { data: ins, error: insErr } = await client
            .from("lead_magnet_recipients")
            .insert({
              angle_id: angle.angle_id,
              post_url: angle.post_url,
              comment_id: cid,
              commenter_id: cUid,
              commenter_name: cName,
              cta_keyword: cta,
              status: "queued",
            })
            .select("recipient_id")
            .single();
          if (insErr) {
            // Likely a unique-constraint hit — another monitor run beat us
            // to it. Skip silently.
            if (insErr.code === "23505") {
              dedupSkipped += 1;
              continue;
            }
            throw insErr;
          }
          recipientId = (ins?.recipient_id as string | null) ?? null;
        } catch (e) {
          logger.error("recipient insert failed", {
            angle_id: angle.angle_id,
            comment_id: cid,
            error: String(e),
          });
          continue;
        }

        try {
          const handle = await tasks.trigger("cta-comment-response", {
            angle_id: angle.angle_id,
            post_url: angle.post_url ?? "",
            comment_id: cid,
            commenter_id: cUid,
            commenter_name: cName,
            cta_keyword: cta,
            // Snapshot at fire time. Engagement loop re-fetches at T+3h
            // so an empty snapshot here is fine — operator can attach
            // the magnet any time within 24h.
            lead_magnet_url: (angle.lead_magnet_url ?? "").trim(),
            recipient_id: recipientId,
          });
          if (recipientId) {
            await client
              .from("lead_magnet_recipients")
              .update({ trigger_run_id: handle.id })
              .eq("recipient_id", recipientId);
          }
          firedTotal += 1;
          logger.info("engagement loop fired", {
            angle_id: angle.angle_id,
            commenter: cName || cUid,
            run_id: handle.id,
          });
        } catch (e) {
          logger.error("trigger fan-out failed", {
            angle_id: angle.angle_id,
            comment_id: cid,
            error: String(e),
          });
          if (recipientId) {
            await client
              .from("lead_magnet_recipients")
              .update({ status: "failed" })
              .eq("recipient_id", recipientId);
          }
        }
      }

      await sleep(PACING_MS_BETWEEN_FETCHES);
    }

    logger.info("monitor-post-comments cycle done", {
      scanned,
      fired: firedTotal,
      dedup_skipped: dedupSkipped,
      no_keyword_hits: noKeywordHits,
    });
    return { scanned, fired: firedTotal };
  },
});
