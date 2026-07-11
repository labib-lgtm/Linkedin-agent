import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { fetchOwnProfileSnapshot } from "./lib/unipile.js";

/**
 * Daily snapshot of our own LinkedIn profile — feeds the audience-over-time
 * chart in the Audience tab. Mirrors trigger/profile_snapshot.ts (which
 * snapshots competitors) but for our own account.
 *
 * Cheap and safe: one Unipile call per non-archived account per day.
 * No downstream cascades, no LinkedIn writes.
 *
 * Runs at 04:00 UTC daily (before profile_snapshot's 05:00 competitor run).
 */

export const snapshotOwnAccount = schedules.task({
  id: "snapshot-own-account",
  cron: "0 4 * * *",
  maxDuration: 5 * 60,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();

    // One row per non-archived account — supports future multi-account setups.
    const { data: accounts, error } = await client
      .from("accounts")
      .select("id, name")
      .is("archived_at", null);
    if (error) {
      logger.error("snapshot-own-account: account fetch failed", { error: error.message });
      throw error;
    }
    if (!accounts || accounts.length === 0) {
      logger.info("snapshot-own-account: no active accounts");
      return { ok: true, snapshots: 0 };
    }

    let snapshots = 0;
    let errors = 0;

    for (const account of accounts) {
      try {
        const snapshot = await fetchOwnProfileSnapshot();
        const { error: insertErr } = await client
          .from("own_account_snapshots")
          .insert({
            account_id: account.id,
            headline: snapshot.headline,
            picture_url: snapshot.picture_url,
            followers_count: snapshot.followers_count,
            connections_count: snapshot.connections_count,
            raw_profile: snapshot.raw,
          });
        if (insertErr) {
          errors += 1;
          logger.warn("snapshot-own-account: insert failed", {
            account_id: account.id,
            error: insertErr.message,
          });
        } else {
          snapshots += 1;
        }
      } catch (e) {
        errors += 1;
        logger.warn("snapshot-own-account: fetch failed", {
          account_id: account.id,
          error: (e as Error).message,
        });
      }
    }

    logger.info("snapshot-own-account done", {
      runId: ctx.run.id,
      accounts: accounts.length,
      snapshots,
      errors,
    });
    return { ok: true, snapshots, errors };
  },
});
