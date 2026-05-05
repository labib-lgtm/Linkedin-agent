import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { postComment, sendDm } from "./lib/unipile.js";
import { patchRecipientRow } from "./lib/supabase.js";

/**
 * CTA comment response — the engagement-loop sequencer.
 *
 * Sequence locked 2026-05-04:
 *   T+0    Public reply on the comment: "Sharing soon, sit tight."
 *   T+3h   Send DM to the commenter with the lead-magnet URL
 *   T+3h   Public follow-up reply on the comment: "Just sent it to your DMs."
 *
 * Triggered by tools/unipile_monitor_comments.py via tools/trigger_engagement.py
 * when a CTA-keyword comment lands on a published post. Each commenter gets
 * their own run.
 *
 * Required Trigger.dev project env vars:
 *   UNIPILE_API_KEY
 *   UNIPILE_DSN
 *   UNIPILE_LINKEDIN_ACCOUNT_ID
 *   SUPABASE_URL                  (for recipient-row patches + audit_log)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

interface CtaPayload {
  angle_id: string;
  post_url: string;
  comment_id: string;
  commenter_id: string;
  commenter_name: string;
  cta_keyword: string;
  lead_magnet_url: string;
  recipient_id?: string | null;
}

const T0_REPLY_TEXT = "Sharing soon, sit tight.";
const T3_FOLLOWUP_TEXT = "Just sent it to your DMs.";

const dmText = (p: CtaPayload) =>
  `Hey ${p.commenter_name || "there"} — here's the ${p.cta_keyword.toLowerCase()} ` +
  `deliverable you asked for:\n\n${p.lead_magnet_url}\n\n` +
  `Reply here if you want me to run it on one of your campaigns.`;

const nowIso = () => new Date().toISOString();

// Best-effort recipient-row patch. Logs but never throws — the public-facing
// engagement steps must continue even if the audit row write fails.
async function safePatch(
  recipientId: string | null | undefined,
  fields: Record<string, string>,
): Promise<void> {
  if (!recipientId) return;
  try {
    await patchRecipientRow({ recipientId, fields });
  } catch (e) {
    logger.warn("recipient-row patch failed", { recipientId, error: String(e), fields });
  }
}

// Extract a Unipile-friendly post identifier from the LinkedIn URL.
function postIdFromUrl(url: string): string {
  const urn = url.match(/urn:li:[a-zA-Z]+:\d+/);
  if (urn) return urn[0];
  const numeric = url.match(/\/(\d{15,25})\/?/);
  if (numeric) return numeric[1];
  throw new Error(`Could not extract post id from URL: ${url}`);
}

export const ctaCommentResponse = task({
  id: "cta-comment-response",
  // 4h ceiling because the body sleeps for 3h between the two touches.
  maxDuration: 60 * 60 * 4,
  run: async (payload: CtaPayload, { ctx }) => {
    logger.info("CTA comment received", {
      runId: ctx.run.id,
      angle_id: payload.angle_id,
      cta_keyword: payload.cta_keyword,
    });

    const postId = postIdFromUrl(payload.post_url);
    await safePatch(payload.recipient_id, { trigger_run_id: ctx.run.id });

    // ─── T+0 — public reply ───────────────────────────────────────
    try {
      await postComment({ postId, text: T0_REPLY_TEXT });
      logger.info("T+0 reply posted", { comment_id: payload.comment_id });
      await safePatch(payload.recipient_id, {
        t0_reply_at: nowIso(),
        status: "replied",
      });
    } catch (e) {
      logger.error("T+0 reply failed", { error: String(e) });
      await safePatch(payload.recipient_id, { status: "failed" });
      throw e;
    }

    // ─── Wait 3 hours ─────────────────────────────────────────────
    // Trigger.dev persists this across worker restarts. The task resumes
    // on whatever worker is online at T+3h.
    await wait.for({ hours: 3 });

    // ─── T+3h — DM with the lead-magnet link ──────────────────────
    try {
      await sendDm({
        recipientId: payload.commenter_id,
        text: dmText(payload),
      });
      logger.info("T+3h DM sent", {
        commenter_id: payload.commenter_id,
        lead_magnet_url: payload.lead_magnet_url,
      });
      await safePatch(payload.recipient_id, {
        dm_sent_at: nowIso(),
        status: "dm_sent",
      });
    } catch (e) {
      logger.error("T+3h DM failed", { error: String(e) });
      await safePatch(payload.recipient_id, { status: "failed" });
      throw e;
    }

    // ─── T+3h — public follow-up reply ────────────────────────────
    try {
      await postComment({ postId, text: T3_FOLLOWUP_TEXT });
      logger.info("T+3h follow-up reply posted", { comment_id: payload.comment_id });
      await safePatch(payload.recipient_id, {
        t3_reply_at: nowIso(),
        status: "completed",
      });
    } catch (e) {
      logger.error("T+3h follow-up reply failed", { error: String(e) });
      // DM already went out, so call it a partial completion rather than failed.
      await safePatch(payload.recipient_id, { status: "completed_partial" });
      throw e;
    }

    return {
      angle_id: payload.angle_id,
      commenter_id: payload.commenter_id,
      cta_keyword: payload.cta_keyword,
      sent_at: nowIso(),
    };
  },
});
