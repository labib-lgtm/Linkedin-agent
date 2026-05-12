import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { postComment } from "./lib/unipile.js";
import { getServiceClient } from "./lib/supabase.js";

/**
 * Pin-comment auto-poster.
 *
 * LinkedIn convention: comment on your own post within the first ~5 min
 * after publishing → the algorithm treats it as engagement and boosts
 * initial reach. Operators use this to drop the lead-magnet link,
 * remind viewers of the CTA keyword, or add context that didn't fit
 * the body.
 *
 * Triggered by /api/angles/[id]/publish after Unipile returns a
 * successful post. Waits 4 min (matches the studio's "drops at T+4 min"
 * label) and posts the angle.pin_comment text as a top-level comment.
 *
 * Required Trigger.dev project env vars:
 *   UNIPILE_API_KEY
 *   UNIPILE_DSN
 *   UNIPILE_LINKEDIN_ACCOUNT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

interface Payload {
  angle_id: string;
  post_url: string;
  pin_text: string;
}

// Same URL → postId resolver pattern as engagement_loop.ts:118.
function postIdFromUrl(url: string): string {
  const urn = url.match(/urn:li:[a-zA-Z]+:\d+/);
  if (urn) return urn[0];
  const numeric = url.match(/\/(\d{15,25})\/?/);
  if (numeric) return numeric[1];
  throw new Error(`Could not extract post id from URL: ${url}`);
}

export const pinCommentTask = task({
  id: "pin-comment",
  // 4-min wait + a few minutes of headroom for Unipile retries.
  maxDuration: 60 * 10,
  run: async (payload: Payload, { ctx }) => {
    logger.info("pin-comment scheduled", {
      runId: ctx.run.id,
      angle_id: payload.angle_id,
      post_url: payload.post_url,
    });

    // Wait 4 min — matches the studio label and the LinkedIn-engagement
    // sweet spot (under 5 min before the algo locks the post's reach
    // trajectory).
    await wait.for({ minutes: 4 });

    let postId: string;
    try {
      postId = postIdFromUrl(payload.post_url);
    } catch (e) {
      logger.error("pin-comment: invalid post_url", { error: String(e), post_url: payload.post_url });
      return { ok: false, error: `invalid post_url: ${(e as Error).message}` };
    }

    try {
      const result = await postComment({ postId, text: payload.pin_text });
      logger.info("pin-comment posted", {
        angle_id: payload.angle_id,
        comment_id: result.id,
      });

      // Best-effort audit log entry — keeps a record of when the pin
      // dropped so the operator can audit cadence later. Doesn't block
      // success if it fails.
      try {
        const sb = getServiceClient();
        await sb.from("audit_log").insert({
          angle_id: payload.angle_id,
          event_type: "pin_comment_posted",
          payload: {
            post_url: payload.post_url,
            comment_id: result.id ?? null,
            text_length: payload.pin_text.length,
          },
        });
      } catch (e) {
        logger.warn("audit_log insert failed", { error: String(e) });
      }

      return { ok: true, comment_id: result.id ?? null };
    } catch (e) {
      logger.error("pin-comment post failed", { error: String(e), angle_id: payload.angle_id });
      return { ok: false, error: (e as Error).message };
    }
  },
});
