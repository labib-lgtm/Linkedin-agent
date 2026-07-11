import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  walkAllRelations,
  getUserProfileLite,
  type RelationRow,
} from "./lib/unipile.js";

/**
 * Audience discovery — full connection walk with per-profile enrichment.
 *
 * Populates audience_connections with a normalized row per 1st-degree
 * connection (name, headline, location, city, country, industry, current
 * company, current role). Idempotent via unique(account_id, provider_id) —
 * re-runs upsert the fresh values and bump last_scanned_at.
 *
 * Pace: 1s between Unipile calls (walkAllRelations pages ~600ms, per-profile
 * lookups ~1s). At ~1,300 connections we're looking at ~22-25 min. Well
 * within the 1h maxDuration.
 */

const PER_CALL_SLEEP_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScanSummary {
  ok: boolean;
  total_walked: number;
  profiles_enriched: number;
  upserted: number;
  errors: number;
  error?: string;
}

export const scanAudienceConnections = task({
  id: "scan-audience-connections",
  queue: {
    name: "scan-audience",
    concurrencyLimit: 1,
  },
  maxDuration: 60 * 60,
  run: async (
    payload: { accountId: string; hardCap?: number },
    { ctx },
  ): Promise<ScanSummary> => {
    const summary: ScanSummary = {
      ok: true,
      total_walked: 0,
      profiles_enriched: 0,
      upserted: 0,
      errors: 0,
    };

    const { accountId } = payload;
    if (!accountId) {
      summary.ok = false;
      summary.error = "scan-audience: accountId required";
      return summary;
    }

    const client = getServiceClient();
    const { data: scanRow, error: scanErr } = await client
      .from("audience_scans")
      .insert({
        account_id: accountId,
        scan_type: "connections",
        run_id: ctx.run.id,
        status: "running",
      })
      .select("id")
      .single();
    if (scanErr || !scanRow) {
      summary.ok = false;
      summary.error = `scan-audience: failed to open scan row: ${scanErr?.message}`;
      return summary;
    }
    const scanId = scanRow.id as string;

    logger.info("scan-audience start", { runId: ctx.run.id, accountId, scanId });

    try {
      const relations: RelationRow[] = await walkAllRelations({
        pageSize: 100,
        hardCap: payload.hardCap ?? 20_000,
      });
      summary.total_walked = relations.length;
      logger.info("scan-audience: walk complete", { total: relations.length });

      await client
        .from("audience_scans")
        .update({ total_walked: relations.length })
        .eq("id", scanId);

      for (const rel of relations) {
        await sleep(PER_CALL_SLEEP_MS);
        let profile;
        try {
          profile = await getUserProfileLite(rel.provider_id);
        } catch (e) {
          summary.errors += 1;
          logger.warn("scan-audience: profile fetch failed", {
            provider_id: rel.provider_id,
            error: (e as Error).message,
          });
          continue;
        }
        if (!profile) continue;
        summary.profiles_enriched += 1;

        const { error: upErr } = await client
          .from("audience_connections")
          .upsert(
            {
              account_id: accountId,
              provider_id: rel.provider_id,
              public_identifier: profile.public_identifier ?? rel.public_identifier,
              full_name: profile.full_name ?? rel.full_name,
              headline: profile.headline ?? rel.headline,
              location: profile.location ?? rel.location,
              city: profile.city,
              country: profile.country,
              industry: profile.industry,
              current_company: profile.current_company,
              current_role: profile.current_role,
              profile_url: profile.profile_url ?? rel.profile_url,
              raw: profile.raw,
              last_scanned_at: new Date().toISOString(),
            },
            { onConflict: "account_id,provider_id" },
          );
        if (upErr) {
          summary.errors += 1;
          logger.warn("scan-audience: upsert failed", {
            provider_id: rel.provider_id,
            error: upErr.message,
          });
          continue;
        }
        summary.upserted += 1;

        if (summary.upserted % 25 === 0) {
          await client
            .from("audience_scans")
            .update({
              matches_upserted: summary.upserted,
            })
            .eq("id", scanId);
          logger.info("scan-audience: progress", {
            enriched: summary.profiles_enriched,
            upserted: summary.upserted,
          });
        }
      }

      await client
        .from("audience_scans")
        .update({
          status: "completed",
          matches_upserted: summary.upserted,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);
      logger.info("scan-audience done", { ...summary });
    } catch (e) {
      summary.ok = false;
      summary.error = (e as Error).message;
      await client
        .from("audience_scans")
        .update({
          status: "failed",
          error: (e as Error).message,
          matches_upserted: summary.upserted,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scanId);
      throw e;
    }

    return summary;
  },
});
