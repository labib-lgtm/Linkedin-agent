import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { getRelations } from "./lib/unipile.js";

/**
 * Refresh the outgoing_invitations state.
 *
 * Every 4h, for each non-archived account:
 *   1. Pull current 1st-degree relations from Unipile.
 *   2. Flip any 'sent' / 'pending' outgoing_invitations rows whose
 *      provider_id appears in relations → 'accepted', stamp accepted_at.
 *   3. Auto-expire rows where sent_at + 14d < now() AND status='pending':
 *      set status='expired' so Tab 2 can highlight them and offer Withdraw.
 *
 * The 14-day threshold matches LinkedIn's soft window before a stale
 * outgoing invite starts to look spammy to their heuristics.
 *
 * The initial send is done by the existing send-prospect-invites task and
 * the new POST /api/audience/segments/[id]/enqueue action — both write
 * an outgoing_invitations row when Unipile /users/invite succeeds. This
 * task never sends anything new; it's a pure state-refresh.
 */

const STALE_THRESHOLD_DAYS = 14;

export const trackOutgoingInvitations = schedules.task({
  id: "track-outgoing-invitations",
  cron: "0 */4 * * *",
  maxDuration: 10 * 60,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();

    const { data: accounts, error: acctErr } = await client
      .from("accounts")
      .select("id")
      .is("archived_at", null);
    if (acctErr) {
      logger.error("track-invites: accounts fetch failed", { error: acctErr.message });
      throw acctErr;
    }
    if (!accounts || accounts.length === 0) return { ok: true };

    let flippedToAccepted = 0;
    let flippedToExpired = 0;

    for (const account of accounts) {
      // Pull current relations once per account. Cache set for O(1) lookup.
      let relationIds: Set<string>;
      try {
        const ids = await getRelations(500);
        relationIds = new Set(ids);
      } catch (e) {
        logger.warn("track-invites: getRelations failed", {
          account_id: account.id,
          error: (e as Error).message,
        });
        continue;
      }

      // Fetch all in-flight invites for the account. Filter to those that
      // could still transition (sent / pending).
      const { data: invites, error: invErr } = await client
        .from("outgoing_invitations")
        .select("id, provider_id, sent_at, status")
        .eq("account_id", account.id)
        .in("status", ["sent", "pending"]);
      if (invErr) {
        logger.warn("track-invites: invites fetch failed", {
          account_id: account.id,
          error: invErr.message,
        });
        continue;
      }

      const nowIso = new Date().toISOString();
      const staleCutoff = new Date(
        Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      for (const inv of invites ?? []) {
        if (relationIds.has(inv.provider_id as string)) {
          const { error: upErr } = await client
            .from("outgoing_invitations")
            .update({
              status: "accepted",
              accepted_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", inv.id);
          if (!upErr) flippedToAccepted += 1;
        } else if ((inv.sent_at as string) < staleCutoff) {
          const { error: upErr } = await client
            .from("outgoing_invitations")
            .update({
              status: "expired",
              updated_at: nowIso,
            })
            .eq("id", inv.id);
          if (!upErr) flippedToExpired += 1;
        } else if (inv.status === "sent") {
          // No transition, but move initial 'sent' to 'pending' so the UI
          // can separate freshly-sent from truly pending.
          await client
            .from("outgoing_invitations")
            .update({ status: "pending", updated_at: nowIso })
            .eq("id", inv.id);
        }
      }
    }

    logger.info("track-invites done", {
      runId: ctx.run.id,
      flipped_to_accepted: flippedToAccepted,
      flipped_to_expired: flippedToExpired,
    });
    return { ok: true, flippedToAccepted, flippedToExpired };
  },
});
