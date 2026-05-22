import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { enrichProspects } from "./enrich_prospects.js";

/**
 * Daily batched prospect enrichment.
 *
 * Lets the operator import all sellers at once (thousands) and have them
 * enriched automatically over time without manual re-firing. Each day this
 * picks the oldest import that still has pending sellers and runs the
 * enrich task with a Sales Nav budget, staying under LinkedIn's ~250/day
 * Sales Nav search quota. The enrich task pauses at the budget (status
 * 'queued' with pending rows remaining); the next day's run resumes it.
 *
 * ~200 Sales Nav calls/day → a few hundred sellers/day depending on the
 * match rate (no_match sellers don't spend Sales Nav budget).
 */

const DAILY_SALESNAV_BUDGET = 200;

export const dailyEnrichProspects = schedules.task({
  id: "daily-enrich-prospects",
  cron: "0 7 * * *", // 7:00 UTC, after track-prospect-posts (6:00)
  maxDuration: 60 * 2,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    logger.info("daily-enrich-prospects start", { runId: ctx.run.id });

    // Oldest pending seller → its import. Process one import per day.
    const { data: pending, error } = await client
      .from("sellers")
      .select("import_id")
      .eq("enrichment_status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      logger.error("pending lookup failed", { error: error.message });
      return { fired: false, error: error.message };
    }
    const importId = pending?.[0]?.import_id as string | undefined;
    if (!importId) {
      logger.info("daily-enrich: nothing pending");
      return { fired: false };
    }

    const handle = await enrichProspects.trigger({
      importId,
      budget: DAILY_SALESNAV_BUDGET,
    });
    logger.info("daily-enrich fired", {
      importId,
      runId: handle.id,
      budget: DAILY_SALESNAV_BUDGET,
    });
    return { fired: true, importId, runId: handle.id };
  },
});
