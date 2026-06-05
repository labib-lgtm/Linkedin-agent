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

// The same LinkedIn account also runs competitor commenting (5/day). With
// prospect commenting at 10/day, combined ceiling is 15/day — still well
// under the ~30/day soft behavioral ceiling for an active human user, with
// the 2-hour min-gap + 3-day per-prospect cooldown + appropriateness filter
// keeping each comment paced and on-topic.
const MAX_PER_DAY = 10;
const MIN_GAP_HOURS = 2;
const PER_PROSPECT_COOLDOWN_DAYS = 3;
const POST_FRESHNESS_DAYS = 14;
const TRACK_SLEEP_MS = 400;

// If the appropriateness gate has rejected this many of a prospect's posts in
// a row AND we've never commented on them, auto-pause the prospect. Their feed
// is almost certainly off-fit (personal, family, etc.) and continuing to
// classify their posts every run just burns budget. The "misfit" badge in the
// Outreach UI surfaces them so the operator can review and unpause if wrong.
const MISFIT_PAUSE_THRESHOLD = 5;

// Skip-warm-up cold-invite path: if a prospect hasn't posted in this many
// days AND has been enrolled for at least the grace period below, the
// comment warm-up cannot land — auto-promote to ready_to_invite with
// cold_invite=true so the operator can decide on a connection request
// without the bot wasting cycles checking their silent feed.
const INACTIVE_DAYS = 30;
const INACTIVE_GRACE_DAYS = 7;

// Bound classifier LLM calls per cron run so a backlog of personal posts can't
// blow up cost. Candidates past the cap simply wait for the next run.
const MAX_CLASSIFY_PER_RUN = 6;

// Length-shape randomizer — forces structural diversity so 30 comments in a row
// don't all read as the same AI three-beat. One is picked per draft.
const LENGTH_SHAPES = [
  "a fragment, 3 to 8 words, no period",
  "one short sentence, 15 words max",
  "one short question",
  "a quick reaction then a short question",
] as const;

// Temperature variance per draft call — same anti-uniformity reason.
const TEMP_RANGE = { min: 0.5, max: 0.9 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomTemp = () => TEMP_RANGE.min + Math.random() * (TEMP_RANGE.max - TEMP_RANGE.min);

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

interface AppropriatenessVerdict {
  appropriate: boolean;
  reason: string;
}

// Tone-safety gate. Runs BEFORE drafting on the selected candidate. Decides
// whether an UNINVITED comment from a B2B marketing agency would be welcome and
// natural on this post, or unwelcome / opportunistic / off-topic.
//
// FAILS CLOSED: any error, timeout, malformed verdict, or uncertainty is treated
// as NOT appropriate (skip). A missed comment costs nothing; a tone-deaf
// auto-comment on someone's baby photo is the exact harm we are preventing.
async function classifyAppropriateness(postText: string): Promise<AppropriatenessVerdict> {
  const text = (postText ?? "").trim();
  if (text.length < 30) {
    return { appropriate: false, reason: "too short to engage substantively" };
  }
  try {
    const res = await generateJson<{ appropriate?: boolean; reason?: string }>({
      model: "moonshotai/kimi-k2.5",
      system:
        "You are a strict gate deciding whether an UNINVITED comment from a B2B " +
        "marketing agency would be welcome and natural on a LinkedIn post. The agency " +
        "comments cold, to warm up a prospect. A wrong yes is far worse than a wrong no.\n\n" +
        "Answer false (NOT appropriate) if the post is any of: personal, family, kids, " +
        "pregnancy, or parenting; a holiday or celebration (Mother's Day, Father's Day, " +
        "birthdays, anniversaries, religious holidays); health, illness, injury, loss, grief, " +
        "death, or a memorial; politics, religion, or activism; an emotional or vulnerable " +
        "disclosure; a job loss, layoff, or firing; humor, satire, comedy, or a joke bit (even " +
        "from a professional creator); a sensitive wellbeing or mental-health topic; NOT written " +
        "in English; or anything where a stranger agency dropping a comment would look " +
        "opportunistic, salesy, or tone-deaf.\n\n" +
        "Answer true (appropriate) ONLY for ordinary professional, business, industry, product, " +
        "ecommerce, marketing, or operational content where a knowledgeable peer commenting is " +
        "natural and expected.\n\n" +
        "When in doubt, answer false.\n\n" +
        'Output JSON {"appropriate": <boolean>, "reason": "<short reason>"}.',
      user: ["Post:", text.slice(0, 2500)].join("\n"),
      temperature: 0,
      maxTokens: 150,
      timeoutMs: 12_000,
    });
    if (typeof res.appropriate !== "boolean") {
      return { appropriate: false, reason: "classifier returned no boolean verdict" };
    }
    return { appropriate: res.appropriate, reason: (res.reason ?? "").slice(0, 300) };
  } catch (e) {
    return { appropriate: false, reason: `classifier_error: ${(e as Error).message}`.slice(0, 300) };
  }
}

// Persist a skip so the post is never re-classified or commented, and bump the
// per-prospect skip counter (surfaces "all their posts are personal" prospects).
// Auto-pauses the prospect when MISFIT_PAUSE_THRESHOLD skips have hit with no
// comments ever sent — at that point their feed is almost certainly off-fit
// and continuing to classify their posts just burns budget.
async function persistSkip(
  client: ReturnType<typeof getServiceClient>,
  post: { id: unknown; prospect_id: unknown },
  reason: string,
  outreachByProspect: Map<
    string,
    { id: unknown; appropriate_skip_count?: unknown; comments_made?: unknown }
  >,
): Promise<void> {
  await client
    .from("prospect_posts")
    .update({ skipped: true, skip_reason: reason, skipped_at: new Date().toISOString() })
    .eq("id", post.id as string);
  const o = outreachByProspect.get(post.prospect_id as string);
  if (!o) return;
  const next = ((o.appropriate_skip_count as number) ?? 0) + 1;
  const commentsMade = (o.comments_made as number) ?? 0;
  const shouldPause = next >= MISFIT_PAUSE_THRESHOLD && commentsMade === 0;
  const update: Record<string, unknown> = { appropriate_skip_count: next };
  if (shouldPause) update.paused = true;
  await client.from("prospect_outreach").update(update).eq("id", o.id as string);
  o.appropriate_skip_count = next; // keep the in-run map consistent
  if (shouldPause) {
    logger.info("prospect auto-paused (misfit)", {
      prospect_id: post.prospect_id,
      skip_count: next,
      threshold: MISFIT_PAUSE_THRESHOLD,
    });
  }
}

// Genuine-engagement comment prompt for the AUTO-SEND prospect warm-up.
// Deliberately omits the business name/description/audience and any stats —
// those produced the pitch-on-a-baby-photo and fabricated-number incidents.
// Voice samples are used for TONE/vocabulary only. The appropriateness gate has
// already confirmed the post is ordinary professional content before we get here.
// `lengthShape` is randomized per call to break structural uniformity.
// Shared rule set — single source of truth for BOTH the drafter (pass 1) and
// the reviewer (pass 2) so the two never drift. Everything learned this session:
// short + de-pitched + no fabricated numbers, plus warm-not-contrarian, no
// manufactured aphorisms/cliches, no filler, plain-beats-clever.
const COMMENT_RULES = `Rules:
- Warm, not contrarian. Build on the poster's point or ask one genuine question. Never undercut them, argue against them, or "well actually" them. This is someone we want a relationship with.
- Engage with the SPECIFIC substance of their post, on their terms. Do not force an Amazon, PPC, or business angle onto a post that is not about that.
- Do NOT pitch or mention your company, services, clients, results, or revenue.
- NEVER invent or cite statistics, percentages, dollar amounts, or specific outcomes. No "we've seen 12-18%", no "$29M", no "studies show".
- No manufactured aphorisms or quotable maxims. Do not write a clever, perfectly balanced one-liner like "viral is just rented attention" or "the unsexy answer that compounds". Crafted maxims read as AI.
- No comment cliches: "stealing this", "this is gold", "this hits", "came here to say this". No filler openers: "Great point", "Great post", "Love this", "This resonates", "Couldn't agree more", "Thanks for sharing", "100%", "So true", "Spot on", "Well said", "Curious to hear more", "Would love your thoughts".
- No filler intensifiers: "actually", "honestly", "literally".
- Plain and slightly imperfect beats clever. Write the way a real person types a quick reply on their phone.
- SHORT: one line, never a paragraph. One sentence is the norm, two short ones is the absolute ceiling. 200 characters max.
- No em-dashes, no asterisks, no hash characters, no hashtags, no tricolons (three parallel items in a row), no three-beat observation-then-reframe-then-question structure.
- If the post is casual or funny, match that register. If you have no genuine reaction, skip rather than force one.`;

// Pass 1 — draft. lengthShape is randomized per call to break structural
// uniformity. The appropriateness gate has already cleared the post.
function commentSystemPrompt(b: BusinessProfile, samples: string[], lengthShape: string): string {
  const samplesBlock =
    samples.length > 0
      ? samples.map((s, i) => `[Sample ${i + 1}]\n${s.slice(0, 700)}`).join("\n\n")
      : "(No prior posts. Use the rules below.)";
  return `You are leaving a LinkedIn comment to start a genuine peer conversation with a potential client. You are NOT selling and you are NOT performing professionalism.

Read the post and write the honest reaction you would give if a peer sent it to you on Slack.

${COMMENT_RULES}

The target shape for THIS comment is: ${lengthShape}. A fragment is fine, starting lowercase is fine, dropping the final period is fine.

Voice samples below show vocabulary and register ONLY. Do not match their length or structure, and do not lift any claims, numbers, or topics from them:
${samplesBlock}

Voice: ${b.voice}

Output strict JSON: { "text": "your comment" } or { "text": "" } to skip.`;
}

// Pass 2 — critique and revise. A deterministic reviewer (temp 0) checks the
// draft against COMMENT_RULES, notes what it fixed, and rewrites. Returns an
// empty final to skip. On reviewer error the caller falls back to the draft.
async function reviseComment(
  post: string,
  draft: string,
  lengthShape: string,
): Promise<{ issues: string; final: string }> {
  try {
    const res = await generateJson<{ issues?: string; final?: string }>({
      model: "anthropic/claude-haiku-4-5",
      temperature: 0,
      maxTokens: 250,
      timeoutMs: 20_000,
      system: `You are a strict editor for LinkedIn comments. You receive the original post and a DRAFT comment. Find every rule violation in the draft, then rewrite the comment so it follows ALL the rules while staying genuine, warm, and short. If the draft cannot be turned into a genuine, rule-compliant comment, return an empty final.

${COMMENT_RULES}

Output strict JSON: { "issues": "<short list of what you fixed, or 'none'>", "final": "<the improved comment, or '' to skip>" }`,
      user: [
        "Original post:",
        "---",
        post.slice(0, 2000),
        "---",
        "",
        "Draft comment:",
        draft,
        "",
        `Target shape: ${lengthShape}.`,
      ].join("\n"),
    });
    return { issues: (res.issues ?? "").slice(0, 300), final: (res.final ?? "").trim() };
  } catch (e) {
    // Reviewer failed — keep the pass-1 draft rather than drop a usable comment.
    return { issues: `reviser_error: ${(e as Error).message}`.slice(0, 300), final: draft };
  }
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
        const { posts, providerId } = await fetchUserPosts(identifier, {
          maxPosts: 20,
          authoredOnly: true, // never track the prospect's reshares of others' posts
        });
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

    // Inactive cold-invite promotion. After the per-prospect post fetch
    // above, look for engaging prospects whose feeds have been silent long
    // enough that the comment warm-up cannot land. Move them to
    // ready_to_invite with cold_invite=true so the operator can decide on
    // a cold connection request. Operator-gated — the send worker still
    // requires invite_approved=true before firing.
    let coldPromoted = 0;
    try {
      const inactiveCutoff = new Date(
        Date.now() - INACTIVE_DAYS * 86_400_000,
      ).toISOString();
      const enrolledCutoff = new Date(
        Date.now() - INACTIVE_GRACE_DAYS * 86_400_000,
      ).toISOString();

      // Candidates: engaging, not paused, not already cold, enrolled long
      // enough that the bot has had a fair shot at tracking + commenting.
      const { data: candidates, error: candErr } = await client
        .from("prospect_outreach")
        .select("id, prospect_id")
        .eq("stage", "engaging")
        .eq("paused", false)
        .eq("cold_invite", false)
        .lte("enrolled_at", enrolledCutoff);
      if (candErr) throw candErr;

      if ((candidates?.length ?? 0) > 0) {
        // Build the set of prospect_ids that have posted within the
        // INACTIVE_DAYS window. Anything NOT in this set is silent.
        // Single global query keeps the URL small (no .in() filter).
        const { data: recentPosts, error: rpErr } = await client
          .from("prospect_posts")
          .select("prospect_id")
          .gte("posted_at", inactiveCutoff);
        if (rpErr) throw rpErr;
        const recentActive = new Set(
          (recentPosts ?? []).map((p) => p.prospect_id as string),
        );

        const inactiveIds = (candidates ?? [])
          .filter((c) => !recentActive.has(c.prospect_id as string))
          .map((c) => c.id as string);

        for (const id of inactiveIds) {
          const { error: upErr } = await client
            .from("prospect_outreach")
            .update({ stage: "ready_to_invite", cold_invite: true })
            .eq("id", id);
          if (upErr) {
            logger.warn("cold-invite promote failed", { id, error: upErr.message });
            continue;
          }
          coldPromoted += 1;
        }
        if (coldPromoted > 0) {
          logger.info("cold-invite promotions", {
            promoted: coldPromoted,
            window_days: INACTIVE_DAYS,
            grace_days: INACTIVE_GRACE_DAYS,
          });
        }
      }
    } catch (e) {
      logger.warn("cold-invite promotion failed", { error: (e as Error).message });
    }

    const summary = { tracked, upserts, failed, coldPromoted };
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
      .select("id, prospect_id, account_id, comments_made, comments_target, appropriate_skip_count")
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

    // Candidate posts: uncommented, fresh, with real text — best engagement
    // first. We DON'T push eligibleIds into a `.in()` filter on the server:
    // with ~500 enrolled prospects the URL bloats past PostgREST's limit and
    // the request fails at the transport layer ("TypeError: fetch failed").
    // Instead we over-fetch the global top by engagement and filter to the
    // eligible set client-side; with the eligibility ratio typically >95%
    // this gives us the same top-50 with one small request.
    const eligibleIdSet = new Set(eligibleIds);
    const freshAgo = new Date(Date.now() - POST_FRESHNESS_DAYS * 86_400_000).toISOString();
    const { data: rawPosts, error: pErr } = await client
      .from("prospect_posts")
      .select("id, prospect_id, account_id, post_id, text, engagement_score, posted_at")
      .eq("commented", false)
      .eq("skipped", false)
      .gte("posted_at", freshAgo)
      .order("engagement_score", { ascending: false })
      .limit(200);
    if (pErr) {
      logger.error("candidate posts fetch failed", { error: pErr.message });
      return { sent: 0, error: pErr.message };
    }
    const posts = (rawPosts ?? [])
      .filter((p) => eligibleIdSet.has(p.prospect_id as string))
      .slice(0, 50);
    logger.info("candidates", {
      raw: rawPosts?.length ?? 0,
      eligible: posts.length,
      eligibleProspects: eligibleIds.length,
    });

    // Walk candidates best-engagement-first. Each one that clears cheap pacing
    // gets the appropriateness gate (bounded per run); the first post that passes
    // the gate AND yields a non-empty draft becomes the comment. Inappropriate
    // posts and drafter-declines are persisted as skipped so they're never
    // reconsidered.
    const business = await loadBusinessProfile(client);
    const lengthShape = pick(LENGTH_SHAPES);
    let target: NonNullable<typeof posts>[number] | null = null;
    let commentText = "";
    let classifyCount = 0;
    let budgetHit = false;

    for (const p of posts ?? []) {
      const aid = p.account_id as string;
      if ((sentToday[aid] ?? 0) >= MAX_PER_DAY) continue;
      if (cooldownSet.has(p.prospect_id as string)) continue;
      const text = (p.text as string | null) ?? "";
      if (text.trim().length <= 30) continue;

      if (classifyCount >= MAX_CLASSIFY_PER_RUN) {
        budgetHit = true;
        logger.info("classify budget reached", { cap: MAX_CLASSIFY_PER_RUN });
        break;
      }
      classifyCount += 1;

      const verdict = await classifyAppropriateness(text);
      if (!verdict.appropriate) {
        logger.info("candidate skipped by appropriateness gate", {
          prospect_id: p.prospect_id,
          post_id: p.post_id,
          reason: verdict.reason,
          dry,
        });
        if (!dry) await persistSkip(client, p, verdict.reason, outreachByProspect);
        continue;
      }

      // Appropriate — draft. A drafter decline ({ text: "" }) or a draft error
      // also skips this post; try the next candidate.
      const samples = await loadVoiceSamples(client, aid, 3);
      let draft = "";
      try {
        const res = await generateJson<{ text?: string }>({
          system: commentSystemPrompt(business, samples, lengthShape),
          user: [
            "Here is the post:",
            "",
            "---",
            text,
            "---",
            "",
            'Write the comment now as your honest reaction, following the shape and rules in the system prompt. Output only the JSON, never your reasoning. If you have nothing genuine to add, output {"text": ""}.',
            "",
            `Target shape for this comment: ${lengthShape}.`,
            "",
            "No em-dashes, no asterisks, no hashtags, no banned openers. Do not pitch. Do not mention your own company, clients, or results. Do not invent any numbers.",
          ].join("\n"),
          model: "anthropic/claude-haiku-4-5",
          temperature: randomTemp(),
          maxTokens: 120,
          timeoutMs: 20_000,
        });
        draft = sanitizeComment((res.text ?? "").trim());
      } catch (e) {
        logger.warn("comment draft failed", {
          post_id: p.post_id,
          error: (e as Error).message,
        });
        continue; // transient draft error — leave the post for a later run
      }

      if (!draft) {
        logger.info("drafter declined candidate", {
          prospect_id: p.prospect_id,
          post_id: p.post_id,
          dry,
        });
        if (!dry) await persistSkip(client, p, "drafter_declined", outreachByProspect);
        continue;
      }

      // Pass 2: self-critique the draft against the rules and rewrite it.
      const rev = await reviseComment(text, draft, lengthShape);
      const finalText = sanitizeComment((rev.final ?? "").trim());
      logger.info("comment draft + revise", {
        prospect_id: p.prospect_id,
        post_id: p.post_id,
        draft,
        issues: rev.issues,
        final: finalText,
      });

      if (!finalText) {
        logger.info("reviewer declined candidate", {
          prospect_id: p.prospect_id,
          post_id: p.post_id,
          dry,
        });
        if (!dry) await persistSkip(client, p, "reviewer_declined", outreachByProspect);
        continue;
      }

      target = p;
      commentText = finalText;
      break;
    }

    if (!target) {
      const reason = budgetHit ? "no_target_budget_hit" : "no_target";
      logger.info("no appropriate post this cycle", { classified: classifyCount, reason });
      return { sent: 0, skipped: reason, classified: classifyCount };
    }

    if (dry) {
      logger.info("DRY RUN — would comment", {
        prospect_id: target.prospect_id,
        post_id: target.post_id,
        comment: commentText,
        shape: lengthShape,
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
