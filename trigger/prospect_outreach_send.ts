import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  sendInvitation,
  getRelations,
  sendDm,
  resolveProviderId,
  identifierFromProfileUrl,
} from "./lib/unipile.js";

/**
 * Phase 2 of prospect warm-outreach: connection requests + acceptance
 * detection + DMs. Hybrid model — the operator approves each invite and DM
 * in the Outreach → Prospect sequence tab; these tasks just SEND the
 * approved ones, paced.
 *
 *   send-prospect-invites      (hourly)  approved ready_to_invite → invited
 *   detect-accepted-invitations(every 4h) invited → connected (via relations)
 *   send-prospect-dms          (hourly)  approved connected → dm_sent
 *
 * LinkedIn caps invitations at ~80-100/day on paid accounts; we stay well
 * under. PROSPECT_OUTREACH_DRY_RUN=1 logs without sending.
 */

const MAX_INVITES_PER_DAY = 15;
const MAX_DMS_PER_DAY = 15;
const PER_RUN_LIMIT = 5;
const SEND_SLEEP_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDryRun = () => process.env.PROSPECT_OUTREACH_DRY_RUN === "1";

interface ProspectRel {
  linkedin_url: string | null;
  provider_id: string | null;
}

function relOf(row: { prospect: unknown }): ProspectRel | null {
  const rel = row.prospect as ProspectRel | ProspectRel[] | null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

// Resolve the LinkedIn member id for an outreach row: cached value first,
// then the prospect's linkedin_url handle. Returns null if unresolvable.
async function resolveId(
  cached: string | null,
  rel: ProspectRel | null,
): Promise<string | null> {
  if (cached && cached.startsWith("ACo")) return cached;
  const handle =
    (rel?.linkedin_url ? identifierFromProfileUrl(rel.linkedin_url) : null) ||
    rel?.provider_id ||
    cached ||
    null;
  if (!handle) return null;
  try {
    return await resolveProviderId(handle);
  } catch {
    return null;
  }
}

// ---- Task 1: send approved invites -------------------------------------

export const sendProspectInvites = schedules.task({
  id: "send-prospect-invites",
  cron: "5 * * * *",
  maxDuration: 60 * 5,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    const dry = isDryRun();
    logger.info("send-prospect-invites start", { runId: ctx.run.id, dry });

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday } = await client
      .from("prospect_outreach")
      .select("id", { count: "exact", head: true })
      .gte("invite_sent_at", dayAgo);
    let budget = MAX_INVITES_PER_DAY - (sentToday ?? 0);
    if (budget <= 0) {
      logger.info("daily invite cap reached", { sentToday });
      return { sent: 0, skipped: "daily_cap" };
    }

    const { data: queue, error } = await client
      .from("prospect_outreach")
      .select("id, prospect_id, provider_id, invite_message, prospect:prospects(linkedin_url, provider_id)")
      .eq("stage", "ready_to_invite")
      .eq("invite_approved", true)
      .eq("paused", false)
      .is("invite_sent_at", null)
      .limit(PER_RUN_LIMIT);
    if (error) return { sent: 0, error: error.message };

    let sent = 0;
    let failed = 0;
    for (const row of queue ?? []) {
      if (budget <= 0) break;
      const providerId = await resolveId(row.provider_id as string | null, relOf(row));
      if (!providerId) {
        logger.warn("invite: unresolvable provider_id", { prospect_id: row.prospect_id });
        failed += 1;
        continue;
      }
      const message = (row.invite_message as string | null) ?? "";
      if (dry) {
        logger.info("DRY RUN — would invite", { prospect_id: row.prospect_id, message });
        continue;
      }
      try {
        await sendInvitation({ providerId, message });
        await client
          .from("prospect_outreach")
          .update({
            stage: "invited",
            invite_sent_at: new Date().toISOString(),
            provider_id: providerId,
          })
          .eq("id", row.id as string);
        sent += 1;
        budget -= 1;
        await sleep(SEND_SLEEP_MS);
      } catch (e) {
        logger.warn("sendInvitation failed", {
          prospect_id: row.prospect_id,
          error: (e as Error).message,
        });
        failed += 1;
      }
    }

    const summary = { sent, failed, dry };
    logger.info("send-prospect-invites done", summary);
    return summary;
  },
});

// ---- Task 2: detect accepted invitations -------------------------------

export const detectAcceptedInvitations = schedules.task({
  id: "detect-accepted-invitations",
  cron: "30 */4 * * *",
  maxDuration: 60 * 5,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    logger.info("detect-accepted-invitations start", { runId: ctx.run.id });

    const { data: invited, error } = await client
      .from("prospect_outreach")
      .select("id, prospect_id, provider_id")
      .eq("stage", "invited");
    if (error) return { connected: 0, error: error.message };
    if (!invited || invited.length === 0) return { connected: 0, skipped: "none_invited" };

    let relations: Set<string>;
    try {
      relations = new Set(await getRelations(500));
    } catch (e) {
      logger.error("getRelations failed", { error: (e as Error).message });
      return { connected: 0, error: (e as Error).message };
    }

    let connected = 0;
    const now = new Date().toISOString();
    for (const row of invited) {
      const pid = row.provider_id as string | null;
      if (pid && relations.has(pid)) {
        await client
          .from("prospect_outreach")
          .update({ stage: "connected", connected_at: now })
          .eq("id", row.id as string);
        connected += 1;
      }
    }

    const summary = { connected, checked: invited.length, relations: relations.size };
    logger.info("detect-accepted-invitations done", summary);
    return summary;
  },
});

// ---- Task 3: send approved DMs -----------------------------------------

export const sendProspectDms = schedules.task({
  id: "send-prospect-dms",
  cron: "35 * * * *",
  maxDuration: 60 * 5,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    const dry = isDryRun();
    logger.info("send-prospect-dms start", { runId: ctx.run.id, dry });

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: sentToday } = await client
      .from("prospect_outreach")
      .select("id", { count: "exact", head: true })
      .gte("dm_sent_at", dayAgo);
    let budget = MAX_DMS_PER_DAY - (sentToday ?? 0);
    if (budget <= 0) {
      logger.info("daily DM cap reached", { sentToday });
      return { sent: 0, skipped: "daily_cap" };
    }

    const { data: queue, error } = await client
      .from("prospect_outreach")
      .select("id, prospect_id, provider_id, dm_text, prospect:prospects(linkedin_url, provider_id)")
      .eq("stage", "connected")
      .eq("dm_approved", true)
      .eq("paused", false)
      .is("dm_sent_at", null)
      .limit(PER_RUN_LIMIT);
    if (error) return { sent: 0, error: error.message };

    let sent = 0;
    let failed = 0;
    for (const row of queue ?? []) {
      if (budget <= 0) break;
      const providerId = await resolveId(row.provider_id as string | null, relOf(row));
      if (!providerId) {
        logger.warn("dm: unresolvable provider_id", { prospect_id: row.prospect_id });
        failed += 1;
        continue;
      }
      const text = (row.dm_text as string | null) ?? "";
      if (!text.trim()) {
        failed += 1;
        continue;
      }
      if (dry) {
        logger.info("DRY RUN — would DM", { prospect_id: row.prospect_id, text });
        continue;
      }
      try {
        await sendDm({ recipientId: providerId, text });
        await client
          .from("prospect_outreach")
          .update({ stage: "dm_sent", dm_sent_at: new Date().toISOString() })
          .eq("id", row.id as string);
        sent += 1;
        budget -= 1;
        await sleep(SEND_SLEEP_MS);
      } catch (e) {
        logger.warn("sendDm failed", {
          prospect_id: row.prospect_id,
          error: (e as Error).message,
        });
        failed += 1;
      }
    }

    const summary = { sent, failed, dry };
    logger.info("send-prospect-dms done", summary);
    return summary;
  },
});
