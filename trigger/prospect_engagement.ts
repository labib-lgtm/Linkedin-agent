import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { generateJson } from "./lib/openrouter.js";
import {
  fetchUserPosts,
  identifierFromProfileUrl,
  postComment,
} from "./lib/unipile.js";
import { enrichProspects } from "./enrich_prospects.js";

// Sales Nav calls per daily batch — under LinkedIn's ~250/day quota. The
// daily enrich kick-off rides on the track-prospect-posts schedule (folded
// in to stay under the Trigger.dev 10-schedule cap).
const DAILY_ENRICH_BUDGET = 200;

/**
 * Phase 1 of prospect warm-outreach: track enrolled prospects' posts and
 * auto-comment on them (paced) to warm them up before a connection request.
 *
 * Two scheduled tasks:
 *   - track-prospect-posts (daily): fetch recent posts for prospects in the
 *     `engaging` stage, upsert into prospect_posts.
 *   - comment-on-prospect-posts (every 30 min, offset): post AT MOST ONE
 *     paced comment per run on an uncommented prospect post; advance the
 *     prospect to `ready_to_invite` once comments_target is hit.
 *
 * Sending is auto (hybrid: comments auto, invites + DMs are Phase 2 with
 * operator approval). Pacing mirrors send_outbound_comments. Set
 * PROSPECT_OUTREACH_DRY_RUN=1 to draft + log without posting.
 */

// Conservative — this LinkedIn account also runs competitor commenting
// (5/day), so prospect comments stay low to keep the combined volume safe.
const MAX_PER_DAY = 3;
const MIN_GAP_HOURS = 2;
const PER_PROSPECT_COOLDOWN_DAYS = 3;
const POST_FRESHNESS_DAYS = 14;
const TRACK_SLEEP_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDryRun(): boolean {
  return process.env.PROSPECT_OUTREACH_DRY_RUN === "1";
}

// Strip the user's banned characters even though the prompt forbids them —
// belt-and-suspenders since these comments auto-send.
function sanitizeComment(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/\*/g, "")
    .replace(/#/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

interface BusinessProfile {
  name: string;
  description: string;
  audience: string;
  voice: string;
}

const BUSINESS_DEFAULTS: BusinessProfile = {
  name: "Lynx Media",
  description:
    "Helps Amazon sellers scale: PPC, listings, DSP, brand registry, FBA, product launches, ranking, conversion. $29M+ Amazon ad spend managed.",
  audience:
    "Operators — Amazon brand owners, agency founders, in-house PPC managers, ecom marketers. Not students, not beginners.",
  voice:
    "Contrarian, specifics over platitudes, operator-grade language. No em-dashes, no asterisks, no hash characters. Concrete numbers and named tactics.",
};

// app_settings is a single JSONB row (id=1) with a `values` map. Mirrors
// webapp getBusinessProfile() so worker drafts match the operator's edits.
async function loadBusinessProfile(
  client: ReturnType<typeof getServiceClient>,
): Promise<BusinessProfile> {
  try {
    const { data } = await client
      .from("app_settings")
      .select("values")
      .eq("id", 1)
      .maybeSingle();
    const v = (data?.values as Record<string, string> | null) ?? {};
    return {
      name: v["business.name"] || BUSINESS_DEFAULTS.name,
      description: v["business.description"] || BUSINESS_DEFAULTS.description,
      audience: v["business.audience"] || BUSINESS_DEFAULTS.audience,
      voice: v["business.voice"] || BUSINESS_DEFAULTS.voice,
    };
  } catch {
    return BUSINESS_DEFAULTS;
  }
}

// Recent posted angles as voice samples; falls back to seeded samples.
async function loadVoiceSamples(
  client: ReturnType<typeof getServiceClient>,
  accountId: string,
  limit = 3,
): Promise<string[]> {
  const samples: string[] = [];
  const { data: posted } = await client
    .from("angles")
    .select("draft_body, date_posted")
    .eq("account_id", accountId)
    .eq("status", "Posted")
    .not("draft_body", "is", null)
    .order("date_posted", { ascending: false })
    .limit(limit);
  for (const row of posted ?? []) {
    const t = (row.draft_body as string | null)?.trim();
    if (t && t.length > 40) samples.push(t);
  }
  if (samples.length < 3) {
    const { data: acct } = await client
      .from("accounts")
      .select("seed_voice_samples")
      .eq("id", accountId)
      .maybeSingle();
    const seeded = (acct?.seed_voice_samples as string | null) ?? "";
    for (const block of seeded.split(/\n{2,}/)) {
      const t = block.trim();
      if (!t || t.length < 40) continue;
      if (samples.length >= limit) break;
      samples.push(t);
    }
  }
  return samples.slice(0, limit);
}

// Mirrors webapp commentReplySystemPrompt (lib/prompts.ts) — kept in sync.
function commentSystemPrompt(b: BusinessProfile, samples: string[]): string {
  const samplesBlock =
    samples.length > 0
      ? samples.map((s, i) => `[Sample ${i + 1}]\n${s.slice(0, 700)}`).join("\n\n")
      : "(No prior posts. Match voice rules below.)";
  return `You write LinkedIn comments for ${b.name}.

Business: ${b.description}
Audience: ${b.audience}
Voice: ${b.voice}

Voice samples:
${samplesBlock}

You receive the original post in the user message. Write a 1-3 sentence comment that:
- Adds something specific (number, named tactic, named tool, named outcome) — not "Great post!"
- References the original post directly
- Sounds like the voice samples — same sentence length, same punctuation density
- No em-dashes, asterisks, hash characters, or generic LinkedIn voice

Output strict JSON:
{ "text": "your comment, <= 320 chars" }`;
}

// ---- Task 1: track posts ------------------------------------------------

export const trackProspectPosts = schedules.task({
  id: "track-prospect-posts",
  cron: "0 6,14,22 * * *",
  maxDuration: 60 * 10,
  run: async (payload, { ctx }) => {
    const client = getServiceClient();
    // Post-tracking runs 3x/day (06:00, 14:00, 22:00 UTC) so a prospect's new
    // post is picked up within hours, not a full day. The daily seller-enrich
    // batch is folded in here (to stay under the 10-schedule cap) but must
    // fire only ONCE per day — gate it to the morning run.
    const enrichHour = payload.timestamp.getUTCHours() < 12;
    logger.info("track-prospect-posts start", {
      runId: ctx.run.id,
      hour: payload.timestamp.getUTCHours(),
      enrich: enrichHour,
    });

    // Daily batched seller enrichment kick-off (folded in here to stay
    // under the 10-schedule cap). Fire BEFORE post-tracking so it always
    // runs even if tracking errors. Picks the oldest import with pending
    // sellers and runs the enrich task with a Sales Nav budget; the enrich
    // task pauses at the budget and resumes next day.
    if (enrichHour) {
      try {
        const { data: pending } = await client
          .from("sellers")
          .select("import_id")
          .eq("enrichment_status", "pending")
          .order("created_at", { ascending: true })
          .limit(1);
        const importId = pending?.[0]?.import_id as string | undefined;
        if (importId) {
          const handle = await enrichProspects.trigger({ importId, budget: DAILY_ENRICH_BUDGET });
          logger.info("daily enrich batch fired", { importId, runId: handle.id, budget: DAILY_ENRICH_BUDGET });
        } else {
          logger.info("daily enrich: nothing pending");
        }
      } catch (e) {
        logger.warn("daily enrich kick-off failed", { error: (e as Error).message });
      }
    }

    const { data: enrolled, error } = await client
      .from("prospect_outreach")
      .select(
        "id, prospect_id, account_id, provider_id, prospect:prospects(linkedin_url, provider_id)",
      )
      .eq("stage", "engaging")
      .eq("paused", false);
    if (error) {
      logger.error("enrolled fetch failed", { error: error.message });
      return { tracked: 0, error: error.message };
    }

    let tracked = 0;
    let upserts = 0;
    let failed = 0;

    for (const row of enrolled ?? []) {
      // Supabase types embedded relations as arrays; take the first.
      const rel = row.prospect as
        | { linkedin_url: string | null; provider_id: string | null }
        | { linkedin_url: string | null; provider_id: string | null }[]
        | null;
      const prospect = Array.isArray(rel) ? (rel[0] ?? null) : rel;
      // Resolution order: cached id → handle from linkedin_url → prospects.provider_id
      const identifier =
        (row.provider_id as string | null) ||
        (prospect?.linkedin_url ? identifierFromProfileUrl(prospect.linkedin_url) : null) ||
        prospect?.provider_id ||
        null;
      if (!identifier) {
        logger.warn("no usable identifier for prospect", { prospect_id: row.prospect_id });
        continue;
      }

      try {
        const { posts, providerId } = await fetchUserPosts(identifier, { maxPosts: 20 });
        // Cache the resolved provider_id so we skip resolution next run.
        if (providerId && providerId !== row.provider_id) {
          await client
            .from("prospect_outreach")
            .update({ provider_id: providerId })
            .eq("id", row.id as string);
        }
        const rows = posts
          .filter((p) => p.post_id && !p.post_id.startsWith("unknown-"))
          .map((p) => ({
            prospect_id: row.prospect_id as string,
            account_id: row.account_id as string,
            post_id: p.post_id,
            posted_at: p.posted_at,
            text: p.text,
            reactions: p.reactions,
            comments: p.comments,
            reposts: p.reposts,
            raw: p.raw,
          }));
        if (rows.length > 0) {
          const { error: upErr } = await client
            .from("prospect_posts")
            .upsert(rows, { onConflict: "prospect_id,post_id", ignoreDuplicates: true });
          if (upErr) logger.warn("prospect_posts upsert failed", { error: upErr.message });
          else upserts += rows.length;
        }
        tracked += 1;
      } catch (e) {
        failed += 1;
        logger.warn("fetchUserPosts failed", {
          prospect_id: row.prospect_id,
          identifier,
          error: (e as Error).message,
        });
      }
      await sleep(TRACK_SLEEP_MS);
    }

    const summary = { tracked, upserts, failed };
    logger.info("track-prospect-posts done", summary);
    return summary;
  },
});

// ---- Task 2: paced auto-commenting -------------------------------------

export const commentOnProspectPosts = schedules.task({
  id: "comment-on-prospect-posts",
  cron: "15,45 * * * *",
  maxDuration: 60 * 5,
  run: async (_payload, { ctx }) => {
    const client = getServiceClient();
    const dry = isDryRun();
    logger.info("comment-on-prospect-posts start", { runId: ctx.run.id, dry });

    // Eligible prospects: engaging, not paused, still under comment target.
    const { data: outreach, error: oErr } = await client
      .from("prospect_outreach")
      .select("id, prospect_id, account_id, comments_made, comments_target")
      .eq("stage", "engaging")
      .eq("paused", false);
    if (oErr) {
      logger.error("outreach fetch failed", { error: oErr.message });
      return { sent: 0, error: oErr.message };
    }
    const eligible = (outreach ?? []).filter(
      (o) => (o.comments_made as number) < (o.comments_target as number),
    );
    if (eligible.length === 0) {
      logger.info("no eligible prospects");
      return { sent: 0, skipped: "none_eligible" };
    }
    const outreachByProspect = new Map(eligible.map((o) => [o.prospect_id as string, o]));
    const eligibleIds = [...outreachByProspect.keys()];

    // Pacing windows from prospect_posts.commented_at.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const cooldownAgo = new Date(
      Date.now() - PER_PROSPECT_COOLDOWN_DAYS * 86_400_000,
    ).toISOString();
    const { data: recentComments } = await client
      .from("prospect_posts")
      .select("prospect_id, account_id, commented_at")
      .eq("commented", true)
      .gte("commented_at", cooldownAgo);

    const sentToday: Record<string, number> = {};
    let lastSentAt: Date | null = null;
    const cooldownSet = new Set<string>();
    for (const r of recentComments ?? []) {
      const ts = new Date(r.commented_at as string);
      if (ts.toISOString() >= dayAgo) {
        const aid = r.account_id as string;
        sentToday[aid] = (sentToday[aid] ?? 0) + 1;
      }
      if (!lastSentAt || ts > lastSentAt) lastSentAt = ts;
      cooldownSet.add(r.prospect_id as string);
    }

    // Global min-gap guard across the account.
    if (lastSentAt && Date.now() - lastSentAt.getTime() < MIN_GAP_HOURS * 3600 * 1000) {
      logger.info("min-gap not elapsed", { lastSentAt: lastSentAt.toISOString() });
      return { sent: 0, skipped: "min_gap" };
    }

    // Candidate posts: uncommented, fresh, with real text, for eligible
    // prospects not in cooldown — best engagement first.
    const freshAgo = new Date(Date.now() - POST_FRESHNESS_DAYS * 86_400_000).toISOString();
    const { data: posts, error: pErr } = await client
      .from("prospect_posts")
      .select("id, prospect_id, account_id, post_id, text, engagement_score, posted_at")
      .eq("commented", false)
      .in("prospect_id", eligibleIds)
      .gte("posted_at", freshAgo)
      .order("engagement_score", { ascending: false })
      .limit(50);
    if (pErr) {
      logger.error("candidate posts fetch failed", { error: pErr.message });
      return { sent: 0, error: pErr.message };
    }

    const target = (posts ?? []).find((p) => {
      const aid = p.account_id as string;
      if ((sentToday[aid] ?? 0) >= MAX_PER_DAY) return false;
      if (cooldownSet.has(p.prospect_id as string)) return false;
      const text = (p.text as string | null) ?? "";
      return text.trim().length > 30;
    });
    if (!target) {
      logger.info("no eligible post this cycle");
      return { sent: 0, skipped: "no_target" };
    }

    // Draft the comment.
    const accountId = target.account_id as string;
    const business = await loadBusinessProfile(client);
    const samples = await loadVoiceSamples(client, accountId, 3);
    let commentText: string;
    try {
      const res = await generateJson<{ text?: string }>({
        system: commentSystemPrompt(business, samples),
        user: [
          "Original post:",
          (target.text as string | null) ?? "(no text)",
          "",
          "Write a 1-3 sentence comment that adds value (specific number, named tactic, named tool, or named outcome). Match the voice samples. No em-dashes, asterisks, or hashtags.",
        ].join("\n"),
        model: "anthropic/claude-haiku-4-5",
        temperature: 0.6,
        maxTokens: 300,
        timeoutMs: 20_000,
      });
      commentText = sanitizeComment((res.text ?? "").trim());
    } catch (e) {
      logger.warn("comment draft failed", { error: (e as Error).message });
      return { sent: 0, error: `draft_failed: ${(e as Error).message}` };
    }
    if (!commentText) {
      logger.warn("empty comment draft");
      return { sent: 0, skipped: "empty_draft" };
    }

    if (dry) {
      logger.info("DRY RUN — would comment", {
        prospect_id: target.prospect_id,
        post_id: target.post_id,
        comment: commentText,
      });
      return { sent: 0, dry: true, draft: commentText };
    }

    // Post it.
    try {
      await postComment({ postId: target.post_id as string, text: commentText });
    } catch (e) {
      logger.warn("postComment failed", {
        prospect_id: target.prospect_id,
        post_id: target.post_id,
        error: (e as Error).message,
      });
      return { sent: 0, error: `post_failed: ${(e as Error).message}` };
    }

    const now = new Date().toISOString();
    await client
      .from("prospect_posts")
      .update({ commented: true, commented_at: now, comment_text: commentText })
      .eq("id", target.id as string);

    const o = outreachByProspect.get(target.prospect_id as string)!;
    const made = (o.comments_made as number) + 1;
    const reachedTarget = made >= (o.comments_target as number);
    await client
      .from("prospect_outreach")
      .update({
        comments_made: made,
        last_comment_at: now,
        ...(reachedTarget ? { stage: "ready_to_invite" } : {}),
      })
      .eq("id", o.id as string);

    logger.info("prospect comment sent", {
      prospect_id: target.prospect_id,
      made,
      reachedTarget,
    });
    return { sent: 1, prospect_id: target.prospect_id, reachedTarget };
  },
});
