import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { listFollowersViaVoyager, type FollowerRow } from "./lib/unipile.js";

/**
 * Follower discovery via Voyager pass-through — ban-risk-gated.
 *
 * Unipile does NOT expose a "list my followers" endpoint. This task
 * proxies arbitrary requests to LinkedIn's internal Voyager API through
 * Unipile's /api/v1/linkedin raw-data endpoint. Bulk enumeration of
 * follower identities is not normal user behavior — LinkedIn's automation
 * guards can flag it.
 *
 * Rollout is phased. The task enforces a hard budget clamp so a
 * misconfigured trigger can't sweep the whole follower graph.
 *
 *   Phase A (day 1):   budget capped to 20. Fire once with 10.
 *   Phase B (day 3+):  ceiling raised to 200. Fire once with 100.
 *   Phase C (week 2):  ceiling raised to 1000. Full walks.
 *
 * Rate: 30s between Voyager calls + up to 30s jitter. Voyager returns up
 * to 40 followers per page; a budget of 200 = ~5 pages = ~5 min of walk
 * time. Slow enough that a human user could plausibly be paging through
 * their followers manually.
 */

const PHASE_BUDGET_CEILING = 20;   // Phase A — bump manually to 200 for B, 1000 for C
const PER_CALL_SLEEP_MS = 30_000;
const PAGE_SIZE = 40;              // Voyager's max per profileMemberFollowers page

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScanSummary {
  ok: boolean;
  budget: number;
  total_walked: number;
  upserted: number;
  errors: number;
  error?: string;
}

export const scanAudienceFollowers = task({
  id: "scan-audience-followers",
  queue: {
    name: "scan-followers",
    concurrencyLimit: 1,
  },
  maxDuration: 60 * 60,
  run: async (
    payload: { accountId: string; budget?: number },
    { ctx },
  ): Promise<ScanSummary> => {
    const summary: ScanSummary = {
      ok: true,
      budget: 0,
      total_walked: 0,
      upserted: 0,
      errors: 0,
    };

    const { accountId } = payload;
    if (!accountId) {
      summary.ok = false;
      summary.error = "scan-followers: accountId required";
      return summary;
    }

    // Hard clamp — ceiling protects against a misconfigured trigger. Raise
    // PHASE_BUDGET_CEILING deliberately when moving from Phase A to B to C.
    const budget = Math.min(Math.max(payload.budget ?? 10, 1), PHASE_BUDGET_CEILING);
    summary.budget = budget;

    const client = getServiceClient();
    const { data: scanRow, error: scanErr } = await client
      .from("audience_scans")
      .insert({
        account_id: accountId,
        scan_type: "followers",
        run_id: ctx.run.id,
        status: "running",
        budget,
      })
      .select("id")
      .single();
    if (scanErr || !scanRow) {
      summary.ok = false;
      summary.error = `scan-followers: failed to open scan row: ${scanErr?.message}`;
      return summary;
    }
    const scanId = scanRow.id as string;

    logger.info("scan-followers start", {
      runId: ctx.run.id,
      accountId,
      budget,
      ceiling: PHASE_BUDGET_CEILING,
    });

    try {
      let start = 0;
      while (summary.total_walked < budget) {
        const remaining = budget - summary.total_walked;
        const count = Math.min(PAGE_SIZE, remaining);
        let page;
        try {
          page = await listFollowersViaVoyager({ start, count });
        } catch (e) {
          summary.errors += 1;
          logger.warn("scan-followers: Voyager call failed", {
            start,
            count,
            error: (e as Error).message,
          });
          // Any Voyager error stops the walk — could be a restriction
          // starting to bite. Bail while we're ahead.
          break;
        }

        if (page.items.length === 0) {
          logger.info("scan-followers: empty page, ending walk", { start });
          break;
        }

        for (const f of page.items) {
          summary.total_walked += 1;
          const { error: upErr } = await client
            .from("audience_followers")
            .upsert(
              {
                account_id: accountId,
                provider_id: f.provider_id,
                public_identifier: f.public_identifier,
                full_name: f.full_name,
                headline: f.headline,
                location: f.location,
                profile_url: f.profile_url,
                raw: f.raw,
                last_scanned_at: new Date().toISOString(),
              },
              { onConflict: "account_id,provider_id" },
            );
          if (upErr) {
            summary.errors += 1;
            logger.warn("scan-followers: upsert failed", {
              provider_id: f.provider_id,
              error: upErr.message,
            });
          } else {
            summary.upserted += 1;
          }
          if (summary.total_walked >= budget) break;
        }

        await client
          .from("audience_scans")
          .update({
            total_walked: summary.total_walked,
            matches_upserted: summary.upserted,
          })
          .eq("id", scanId);

        start += page.items.length;

        if (summary.total_walked >= budget) break;

        const jitter = Math.floor(Math.random() * 30_000);
        await sleep(PER_CALL_SLEEP_MS + jitter);
      }

      await client
        .from("audience_scans")
        .update({
          status: "completed",
          total_walked: summary.total_walked,
          matches_upserted: summary.upserted,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);
      logger.info("scan-followers done", { ...summary });
    } catch (e) {
      summary.ok = false;
      summary.error = (e as Error).message;
      await client
        .from("audience_scans")
        .update({
          status: "failed",
          error: (e as Error).message,
          total_walked: summary.total_walked,
          matches_upserted: summary.upserted,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);
      throw e;
    }

    return summary;
  },
});
