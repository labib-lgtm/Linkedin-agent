import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { postComment } from "./lib/unipile.js";

/**
 * Phase G — outbound comments.
 *
 * Posts approved outbound_comments to LinkedIn via Unipile. Per the
 * roast: "5/hour/account = 120/day. LinkedIn flags new automation at
 * ~20 unsolicited comments per day. Real number: 3-5 PER DAY,
 * mandatory 2-hour gaps, never two on the same author within 7 days."
 *
 * Pacing enforced here:
 *   - max 5 comments per account per 24h rolling window
 *   - mandatory 2h gap between sends per account
 *   - skip if the same competitor was already commented on within 7d
 *
 * Schedule: every 30 min.
 */

const MAX_PER_DAY = 5;
const MIN_GAP_HOURS = 2;
const SAME_AUTHOR_COOLDOWN_DAYS = 7;

const supabase = getServiceClient;

export const sendOutboundComments = schedules.task({
  id: "send-outbound-comments",
  cron: "*/30 * * * *",
  maxDuration: 60 * 5,
  run: async (_payload, { ctx }) => {
    const client = supabase();
    logger.info("starting outbound-comments cycle", { runId: ctx.run.id });

    const { data: approved, error } = await client
      .from("outbound_comments")
      .select("id, account_id, competitor_post_id, competitor_id, draft_comment, approved_at")
      .eq("status", "approved")
      .order("approved_at", { ascending: true });
    if (error) {
      logger.error("approved fetch failed", { error: error.message });
      return { sent: 0, skipped: 0, error: error.message };
    }

    const summary = { sent: 0, skipped_pacing: 0, skipped_cooldown: 0, failed: 0 };
    const sentToday: Record<string, number> = {};
    const lastSentAt: Record<string, Date> = {};

    // Pre-load 24h send history per account to count toward MAX_PER_DAY.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recentSends } = await client
      .from("outbound_comments")
      .select("account_id, competitor_id, sent_at")
      .eq("status", "sent")
      .gte("sent_at", dayAgo);
    for (const r of recentSends ?? []) {
      const aid = r.account_id as string;
      sentToday[aid] = (sentToday[aid] ?? 0) + 1;
      const ts = new Date(r.sent_at as string);
      if (!lastSentAt[aid] || ts > lastSentAt[aid]) lastSentAt[aid] = ts;
    }

    // 7d cooldown set: account_id|competitor_id
    const cooldownDate = new Date(Date.now() - SAME_AUTHOR_COOLDOWN_DAYS * 86_400_000).toISOString();
    const { data: cooldownSends } = await client
      .from("outbound_comments")
      .select("account_id, competitor_id")
      .eq("status", "sent")
      .gte("sent_at", cooldownDate);
    const cooldownSet = new Set(
      (cooldownSends ?? [])
        .filter((r) => r.competitor_id)
        .map((r) => `${r.account_id}|${r.competitor_id}`),
    );

    for (const row of approved ?? []) {
      const aid = row.account_id as string;
      const cid = row.competitor_id as string | null;

      if ((sentToday[aid] ?? 0) >= MAX_PER_DAY) {
        summary.skipped_pacing += 1;
        continue;
      }
      const last = lastSentAt[aid];
      if (last && Date.now() - last.getTime() < MIN_GAP_HOURS * 3600 * 1000) {
        summary.skipped_pacing += 1;
        continue;
      }
      if (cid && cooldownSet.has(`${aid}|${cid}`)) {
        summary.skipped_cooldown += 1;
        continue;
      }

      try {
        await postComment({
          postId: row.competitor_post_id as string,
          text: (row.draft_comment as string) ?? "",
        });
        await client
          .from("outbound_comments")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id as string);
        summary.sent += 1;
        sentToday[aid] = (sentToday[aid] ?? 0) + 1;
        lastSentAt[aid] = new Date();
        if (cid) cooldownSet.add(`${aid}|${cid}`);
      } catch (e) {
        logger.warn("outbound comment send failed", {
          id: row.id,
          error: (e as Error).message,
        });
        await client
          .from("outbound_comments")
          .update({ status: "rejected" })
          .eq("id", row.id as string);
        summary.failed += 1;
      }
    }

    logger.info("outbound-comments cycle complete", summary);
    return summary;
  },
});
