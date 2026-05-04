import { logger, task, wait } from "@trigger.dev/sdk/v3";

/**
 * CTA comment response — the engagement-loop sequencer.
 *
 * Sequence locked 2026-05-04:
 *   T+0    Public reply on the comment: "Sharing soon, sit tight."
 *   T+3h   Send DM to the commenter with the lead-magnet URL
 *   T+3h   Public follow-up reply on the comment: "Just sent it to your DMs."
 *
 * Triggered by 08_engagement_loop.md when `unipile_monitor_comments.py`
 * detects a CTA keyword on a published post. Each commenter gets their own
 * run of this task.
 *
 * The 3-hour delay keeps engagement on the post alive past the first-hour
 * reach window, gives social proof to other readers, and reads less salesy
 * than instant DM.
 */
export const ctaCommentResponse = task({
  id: "cta-comment-response",
  // 4h ceiling because the body sleeps for 3h between the two touches.
  maxDuration: 60 * 60 * 4,
  run: async (
    payload: {
      angle_id: string;
      post_url: string;
      comment_id: string;
      commenter_id: string;
      commenter_name: string;
      cta_keyword: string;
      lead_magnet_url: string; // from the angles tab, populated by 05b_lead_magnet
    },
    { ctx },
  ) => {
    logger.info("CTA comment received", { payload, runId: ctx.run.id });

    // T+0 — public reply on the comment.
    // TODO(phase B): wire to tools/unipile_publish_comment.py via fetch
    // adapter or a shell-out from this Node task. For now, log only.
    logger.info("T+0 reply: 'Sharing soon, sit tight.'", {
      comment_id: payload.comment_id,
    });

    // Wait 3 hours. Trigger.dev persists this across restarts.
    await wait.for({ hours: 3 });

    // T+3h — DM with the lead-magnet URL.
    // TODO(phase B): wire to tools/unipile_send_dm.py
    logger.info("T+3h DM with lead-magnet link", {
      commenter_id: payload.commenter_id,
      lead_magnet_url: payload.lead_magnet_url,
    });

    // T+3h — public follow-up reply.
    // TODO(phase B): wire to tools/unipile_publish_comment.py
    logger.info("T+3h follow-up reply: 'Just sent it to your DMs.'", {
      comment_id: payload.comment_id,
    });

    return {
      angle_id: payload.angle_id,
      commenter_id: payload.commenter_id,
      cta_keyword: payload.cta_keyword,
      sent_at: new Date().toISOString(),
    };
  },
});
