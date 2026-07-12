import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";

/**
 * Daily audience-outbound sourcer.
 *
 * For each target_segments row where auto_send=true and paused_at IS NULL,
 * pull up to daily_send_cap engagers that match the segment (via the GIN
 * matched_segment_ids column on competitor_engagers) and haven't already
 * been invited on this account. Materialise each into a prospect_outreach
 * row (stage='ready_to_invite', invite_approved=true) so the existing
 * hourly send-prospect-invites cron sends them at pace. Also mirror the
 * candidate into outgoing_invitations as status='queued' so Tab 3's queue
 * dashboard sees them immediately.
 *
 * Safety pass runs FIRST for every segment. If the 14-day acceptance rate
 * is under 15% AND the segment has >= 20 sends in the window, or a 30-day
 * bucket has >= 30 sends with 0 accepts, we auto-pause the segment (set
 * paused_at + pause_reason) and skip sourcing. Resume is manual via the
 * Tab 3 button.
 *
 * The task carries no per-segment throttle beyond daily_send_cap; the
 * global daily invite cap on the account is enforced downstream by
 * send-prospect-invites (MAX_INVITES_PER_DAY).
 *
 * Cron: 07:00 UTC daily (before send-prospect-invites hits its :05 tick).
 */

const ACCEPTANCE_RATE_MIN = 0.15;
const MIN_SENDS_FOR_RATE_CHECK = 20;
const LONG_TAIL_SENDS = 30;

// Simple {first_name} interpolation from the full display name. Falls back
// to a neutral "there" so the template never leaks the raw placeholder.
function interpolate(template: string | null, fullName: string | null): string {
  if (!template) return "";
  const first = firstNameOf(fullName);
  return template.replaceAll("{first_name}", first || "there");
}

function firstNameOf(name: string | null): string {
  if (!name) return "";
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  return space > 0 ? trimmed.slice(0, space) : trimmed;
}

interface Segment {
  id: string;
  account_id: string;
  name: string;
  daily_send_cap: number;
  invite_template: string | null;
  dm_template: string | null;
  auto_send: boolean;
  paused_at: string | null;
}

interface RunSummary {
  ok: boolean;
  segments_checked: number;
  segments_paused: number;
  candidates_enqueued: number;
  segment_reports: Array<{
    segment_id: string;
    name: string;
    action: "sourced" | "paused" | "skipped_no_pool" | "skipped_no_template";
    detail?: string;
    count?: number;
  }>;
  error?: string;
}

export const sourceAudienceCandidates = schedules.task({
  id: "source-audience-candidates",
  cron: "0 7 * * *",
  maxDuration: 15 * 60,
  run: async (_payload, { ctx }): Promise<RunSummary> => {
    const client = getServiceClient();

    const { data: segments, error } = await client
      .from("target_segments")
      .select(
        "id, account_id, name, daily_send_cap, invite_template, dm_template, auto_send, paused_at",
      )
      .eq("auto_send", true)
      .is("archived_at", null)
      .is("paused_at", null);
    if (error) {
      logger.error("source-audience: segments fetch failed", { error: error.message });
      return { ok: false, segments_checked: 0, segments_paused: 0, candidates_enqueued: 0, segment_reports: [], error: error.message };
    }

    const summary: RunSummary = {
      ok: true,
      segments_checked: segments?.length ?? 0,
      segments_paused: 0,
      candidates_enqueued: 0,
      segment_reports: [],
    };
    logger.info("source-audience: start", { runId: ctx.run.id, segments: summary.segments_checked });

    for (const seg of (segments ?? []) as Segment[]) {
      // Fail-closed: require a template. A segment can be auto-send=true
      // with an empty invite_template if the operator toggled the switch
      // without filling the form — skip rather than send an empty note.
      if (!seg.invite_template || !seg.invite_template.trim()) {
        summary.segment_reports.push({
          segment_id: seg.id,
          name: seg.name,
          action: "skipped_no_template",
          detail: "invite_template is empty",
        });
        continue;
      }

      // Safety pass — auto-pause if signal is bad.
      const pause = await computePauseReason(client, seg);
      if (pause) {
        await client
          .from("target_segments")
          .update({
            paused_at: new Date().toISOString(),
            pause_reason: pause,
            updated_at: new Date().toISOString(),
          })
          .eq("id", seg.id);
        summary.segments_paused += 1;
        summary.segment_reports.push({
          segment_id: seg.id,
          name: seg.name,
          action: "paused",
          detail: pause,
        });
        logger.info("source-audience: segment paused", { segment_id: seg.id, reason: pause });
        continue;
      }

      // Find candidate engagers matching this segment that don't already
      // have an outgoing_invitations row on this account. Query is
      // account-scoped and uses the GIN containment operator on the
      // matched_segment_ids array.
      const alreadyInvited = await fetchAlreadyInvitedIds(client, seg.account_id);
      const { data: engagers, error: engErr } = await client
        .from("competitor_engagers")
        .select(
          "id, provider_id, public_identifier, full_name, headline, location, industry, current_company, job_title, profile_url",
        )
        .eq("account_id", seg.account_id)
        .contains("matched_segment_ids", [seg.id])
        .order("last_seen_at", { ascending: false })
        .limit(seg.daily_send_cap * 3); // over-fetch to skip already-invited
      if (engErr) {
        logger.warn("source-audience: engagers fetch failed", {
          segment_id: seg.id,
          error: engErr.message,
        });
        continue;
      }

      const fresh = (engagers ?? []).filter((e) => !alreadyInvited.has(e.provider_id as string));
      const take = fresh.slice(0, seg.daily_send_cap);
      if (take.length === 0) {
        summary.segment_reports.push({
          segment_id: seg.id,
          name: seg.name,
          action: "skipped_no_pool",
          detail: `${engagers?.length ?? 0} matched, all already invited`,
        });
        continue;
      }

      let enqueued = 0;
      for (const eng of take) {
        try {
          // Upsert a prospects row (audience-sourced, no seller). The
          // partial unique in migration 031 keys on (account_id,
          // provider_id) when seller_id IS NULL.
          const { data: prospect, error: pErr } = await client
            .from("prospects")
            .upsert(
              {
                account_id: seg.account_id,
                provider_id: eng.provider_id,
                name: eng.full_name,
                headline: eng.headline,
                linkedin_url: eng.profile_url,
                source: "audience_engager",
                engager_id: eng.id,
                seller_id: null,
              },
              { onConflict: "account_id,provider_id", ignoreDuplicates: false },
            )
            .select("id")
            .single();
          if (pErr || !prospect) {
            logger.warn("source-audience: prospects upsert failed", {
              provider_id: eng.provider_id,
              error: pErr?.message,
            });
            continue;
          }

          const inviteMsg = interpolate(seg.invite_template, eng.full_name as string | null);
          const dmMsg = interpolate(seg.dm_template, eng.full_name as string | null);

          // Insert into prospect_outreach as ready-to-invite + auto-approved.
          const { error: outErr } = await client
            .from("prospect_outreach")
            .insert({
              account_id: seg.account_id,
              prospect_id: prospect.id,
              provider_id: eng.provider_id,
              stage: "ready_to_invite",
              invite_approved: true,
              invite_message: inviteMsg,
              dm_approved: dmMsg ? true : false,
              dm_text: dmMsg || null,
            });
          if (outErr) {
            // Unique index on (account_id, prospect_id) or similar may
            // reject re-enrolls. Skip and move on.
            logger.warn("source-audience: prospect_outreach insert failed", {
              provider_id: eng.provider_id,
              error: outErr.message,
            });
            continue;
          }

          // Mirror into outgoing_invitations for Tab 3 visibility. Status
          // 'sent' matches what send-prospect-invites will mirror when it
          // actually fires the Unipile call; we mark 'sent' with a null
          // raw so the two writes reconcile (the sender inserts a fresh
          // row with the same segment_id + provider_id + a later sent_at).
          //
          // We use 'sent' rather than adding a new 'queued' status to
          // keep the outgoing_invitations status enum stable — the daily
          // rollup already handles duplicate sends per person via the
          // unique (account_id, provider_id, sent_at).
          await client.from("outgoing_invitations").insert({
            account_id: seg.account_id,
            provider_id: eng.provider_id,
            full_name: eng.full_name,
            headline: eng.headline,
            note: inviteMsg,
            status: "sent",
            segment_id: seg.id,
          });

          enqueued += 1;
        } catch (e) {
          logger.warn("source-audience: candidate enqueue failed", {
            provider_id: eng.provider_id,
            error: (e as Error).message,
          });
        }
      }

      summary.candidates_enqueued += enqueued;
      summary.segment_reports.push({
        segment_id: seg.id,
        name: seg.name,
        action: "sourced",
        count: enqueued,
      });
      logger.info("source-audience: segment sourced", {
        segment_id: seg.id,
        cap: seg.daily_send_cap,
        enqueued,
      });
    }

    logger.info("source-audience done", {
      runId: ctx.run.id,
      segments_checked: summary.segments_checked,
      segments_paused: summary.segments_paused,
      candidates_enqueued: summary.candidates_enqueued,
    });
    return summary;
  },
});

/** Fetch every provider_id already invited on this account (sent, pending,
 *  or accepted) so we don't re-invite. Withdrawn / expired can be
 *  re-approached — LinkedIn's own soft rule is that withdrawn invites can
 *  be re-sent after a cool-off, and expired ones are eligible immediately. */
async function fetchAlreadyInvitedIds(
  client: ReturnType<typeof getServiceClient>,
  accountId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  while (offset < 50_000) {
    const { data, error } = await client
      .from("outgoing_invitations")
      .select("provider_id")
      .eq("account_id", accountId)
      .in("status", ["sent", "pending", "accepted"])
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) ids.add(r.provider_id as string);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return ids;
}

/** Compute the pause reason for a segment based on its outgoing invitation
 *  history. Returns null when the segment should keep running. */
async function computePauseReason(
  client: ReturnType<typeof getServiceClient>,
  seg: Segment,
): Promise<string | null> {
  const day14Ago = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const day30Ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 14-day acceptance-rate check.
  const { count: sent14 } = await client
    .from("outgoing_invitations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", seg.account_id)
    .eq("segment_id", seg.id)
    .gte("sent_at", day14Ago);
  if ((sent14 ?? 0) >= MIN_SENDS_FOR_RATE_CHECK) {
    const { count: accepted14 } = await client
      .from("outgoing_invitations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", seg.account_id)
      .eq("segment_id", seg.id)
      .eq("status", "accepted")
      .gte("sent_at", day14Ago);
    const rate = (accepted14 ?? 0) / (sent14 ?? 1);
    if (rate < ACCEPTANCE_RATE_MIN) {
      return `14-day acceptance rate ${Math.round(rate * 100)}% below ${Math.round(ACCEPTANCE_RATE_MIN * 100)}% (${accepted14 ?? 0}/${sent14 ?? 0})`;
    }
  }

  // Long-tail: 30d with many sends and zero accepts.
  const { count: sent30 } = await client
    .from("outgoing_invitations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", seg.account_id)
    .eq("segment_id", seg.id)
    .gte("sent_at", day30Ago);
  if ((sent30 ?? 0) >= LONG_TAIL_SENDS) {
    const { count: accepted30 } = await client
      .from("outgoing_invitations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", seg.account_id)
      .eq("segment_id", seg.id)
      .eq("status", "accepted")
      .gte("sent_at", day30Ago);
    if ((accepted30 ?? 0) === 0) {
      return `30-day tail: ${sent30 ?? 0} sends, 0 accepts`;
    }
  }

  return null;
}
