import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  sendInvitation,
  getRelations,
  sendDm,
  listChatMessages,
  resolveProviderId,
  identifierFromProfileUrl,
} from "./lib/unipile.js";

/**
 * Phase 2 + 3 of prospect warm-outreach: connection requests, acceptance
 * detection, DMs, reply detection, and a follow-up bump. Hybrid model —
 * the operator approves each invite and first DM in the Outreach →
 * Prospect sequence tab; these tasks send the approved ones, paced.
 *
 *   send-prospect-invites      (hourly)  approved ready_to_invite → invited
 *                                        + auto follow-up DM (dm_sent, no
 *                                          reply) is handled in send-dms
 *   detect-accepted-invitations(every 4h) invited → connected (relations)
 *                                        + dm_sent → responded (replies)
 *   send-prospect-dms          (hourly)  approved connected → dm_sent;
 *                                        also sends the no-reply follow-up
 *
 * LinkedIn caps invitations at ~80-100/day on paid accounts; we stay well
 * under. PROSPECT_OUTREACH_DRY_RUN=1 logs without sending.
 */

// Daily ceiling across BOTH pipelines (Amazon-seller prospect_outreach +
// audience-sourced rows). Bumped from 15 to 30 when the audience outbound
// engine went live so the two paths don't crowd each other. LinkedIn's
// soft weekly-outbound tolerance is ~100 for accounts with prior activity;
// 30/day * 5d = 150/wk is aggressive but the fail-closed gates on
// source-audience-candidates catch any acceptance-rate dip before it
// escalates to a restriction.
const MAX_INVITES_PER_DAY = 30;
const MAX_DMS_PER_DAY = 15;
const PER_RUN_LIMIT = 5;
const SEND_SLEEP_MS = 1500;
// Follow-up bump: one gentle nudge if no reply after this many days.
const FOLLOWUP_DELAY_DAYS = 4;
const MAX_FOLLOWUPS = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDryRun = () => process.env.PROSPECT_OUTREACH_DRY_RUN === "1";

interface ProspectRel {
  linkedin_url: string | null;
  provider_id: string | null;
  name?: string | null;
  headline?: string | null;
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
      .select("id, account_id, prospect_id, provider_id, invite_message, prospect:prospects(linkedin_url, provider_id, name, headline)")
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
        const sentAt = new Date().toISOString();
        await client
          .from("prospect_outreach")
          .update({
            stage: "invited",
            invite_sent_at: sentAt,
            provider_id: providerId,
          })
          .eq("id", row.id as string);
        // Mirror into outgoing_invitations so the Audience Requests tab
        // reflects every invite this pipeline sends — not just what Tab 3
        // enqueues directly.
        const prospect = relOf(row);
        await client
          .from("outgoing_invitations")
          .insert({
            account_id: row.account_id as string,
            provider_id: providerId,
            full_name: prospect?.name ?? null,
            headline: prospect?.headline ?? null,
            note: message || null,
            status: "sent",
            sent_at: sentAt,
            linked_prospect_outreach_id: row.id as string,
          })
          .then(({ error: mirrErr }) => {
            if (mirrErr) {
              // Non-fatal: the invite still went out, and the audience
              // table is the mirror layer. Log so we can spot drift.
              logger.warn("outgoing_invitations mirror insert failed", {
                prospect_id: row.prospect_id,
                error: mirrErr.message,
              });
            }
          });
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

    // Reply detection: for dm_sent prospects, poll their chat — any message
    // not from us (is_sender=false) means they replied. Hand off to the
    // human: stage → responded, prospect.status → responded.
    let replied = 0;
    const { data: dmSent } = await client
      .from("prospect_outreach")
      .select("id, prospect_id, dm_chat_id")
      .eq("stage", "dm_sent")
      .not("dm_chat_id", "is", null);
    for (const row of dmSent ?? []) {
      const chatId = row.dm_chat_id as string;
      try {
        const msgs = await listChatMessages(chatId, 20);
        const reply = msgs.find((m) => !m.is_sender && m.text.trim().length > 0);
        if (reply) {
          await client
            .from("prospect_outreach")
            .update({
              stage: "responded",
              replied_at: new Date().toISOString(),
              reply_snippet: reply.text.slice(0, 300),
            })
            .eq("id", row.id as string);
          await client
            .from("prospects")
            .update({ status: "responded" })
            .eq("id", row.prospect_id as string);
          replied += 1;
        }
      } catch (e) {
        logger.warn("reply check failed", {
          prospect_id: row.prospect_id,
          error: (e as Error).message,
        });
      }
    }

    const summary = {
      connected,
      replied,
      checked: invited.length,
      dm_checked: dmSent?.length ?? 0,
      relations: relations.size,
    };
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
        const res = await sendDm({ recipientId: providerId, text });
        await client
          .from("prospect_outreach")
          .update({
            stage: "dm_sent",
            dm_sent_at: new Date().toISOString(),
            dm_chat_id: res.chat_id ?? null, // polled later for replies
          })
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

    // Follow-up bump: one gentle nudge to dm_sent prospects who haven't
    // replied after FOLLOWUP_DELAY_DAYS. Auto-sent (they're already a
    // connection who got an approved first DM) and capped at MAX_FOLLOWUPS.
    let followups = 0;
    if (budget > 0) {
      const cutoff = new Date(Date.now() - FOLLOWUP_DELAY_DAYS * 86_400_000).toISOString();
      const { data: fq } = await client
        .from("prospect_outreach")
        .select(
          "id, prospect_id, provider_id, dm_sent_at, last_followup_at, followups_sent, dm_chat_id, prospect:prospects(name, linkedin_url, provider_id)",
        )
        .eq("stage", "dm_sent")
        .eq("paused", false)
        .lt("followups_sent", MAX_FOLLOWUPS)
        .limit(PER_RUN_LIMIT);
      for (const row of fq ?? []) {
        if (budget <= 0) break;
        const lastTouch =
          (row.last_followup_at as string | null) ?? (row.dm_sent_at as string | null);
        if (lastTouch && lastTouch > cutoff) continue; // too soon
        const relP = relOf(row);
        const providerId = await resolveId(row.provider_id as string | null, relP);
        if (!providerId) {
          failed += 1;
          continue;
        }
        const rawName = Array.isArray(row.prospect)
          ? (row.prospect[0] as { name?: string } | undefined)?.name
          : (row.prospect as { name?: string } | null)?.name;
        const fn = (rawName ?? "").trim().split(/\s+/)[0] || "there";
        const text = `Hey ${fn}, floating this back up in case it got buried. No worries if the timing is off.`;
        if (dry) {
          logger.info("DRY RUN — would follow up", { prospect_id: row.prospect_id, text });
          continue;
        }
        try {
          await sendDm({ recipientId: providerId, text });
          await client
            .from("prospect_outreach")
            .update({
              followups_sent: (row.followups_sent as number) + 1,
              last_followup_at: new Date().toISOString(),
            })
            .eq("id", row.id as string);
          followups += 1;
          budget -= 1;
          await sleep(SEND_SLEEP_MS);
        } catch (e) {
          logger.warn("follow-up DM failed", {
            prospect_id: row.prospect_id,
            error: (e as Error).message,
          });
          failed += 1;
        }
      }
    }

    const summary = { sent, followups, failed, dry };
    logger.info("send-prospect-dms done", summary);
    return summary;
  },
});
