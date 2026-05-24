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

// Bound classifier LLM calls per cron run so a backlog of personal posts can't
// blow up cost. Candidates past the cap simply wait for the next run.
const MAX_CLASSIFY_PER_RUN = 6;

// Length-shape randomizer — forces structural diversity so 30 comments in a row
// don't all read as the same AI three-beat. One is picked per draft.
const LENGTH_SHAPES = [
  "fragment (3-8 words, no period needed)",
  "one short sentence",
  "one genuine question",
  "two short sentences",
  "a reaction word or two then a question",
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
async function persistSkip(
  client: ReturnType<typeof getServiceClient>,
  post: { id: unknown; prospect_id: unknown },
  reason: string,
  outreachByProspect: Map<string, { id: unknown; appropriate_skip_count?: unknown }>,
): Promise<void> {
  await client
    .from("prospect_posts")
    .update({ skipped: true, skip_reason: reason, skipped_at: new Date().toISOString() })
    .eq("id", post.id as string);
  const o = outreachByProspect.get(post.prospect_id as string);
  if (o) {
    const next = ((o.appropriate_skip_count as number) ?? 0) + 1;
    await client
      .from("prospect_outreach")
      .update({ appropriate_skip_count: next })
      .eq("id", o.id as string);
    o.appropriate_skip_count = next; // keep the in-run map consistent
  }
}

// Genuine-engagement comment prompt for the AUTO-SEND prospect warm-up.
// Deliberately omits the business name/description/audience and any stats —
// those produced the pitch-on-a-baby-photo and fabricated-number incidents.
// Voice samples are used for TONE/vocabulary only. The appropriateness gate has
// already confirmed the post is ordinary professional content before we get here.
// `lengthShape` is randomized per call to break structural uniformity.
function commentSystemPrompt(b: BusinessProfile, samples: string[], lengthShape: string): string {
  const samplesBlock =
    samples.length > 0
      ? samples.map((s, i) => `[Sample ${i + 1}]\n${s.slice(0, 700)}`).join("\n\n")
      : "(No prior posts. Use the rules below.)";
  return `You are leaving a LinkedIn comment to start a genuine peer conversation. You are NOT selling and you are NOT performing professionalism.

Read the post first. Identify what it is actually about and what your honest reaction would be if a peer sent it to you on Slack. Write that reaction.

If you have no genuine reaction, if the only thing you could say is "Great point!" or some variation, output {"text": ""} and we will skip the post. Forcing a comment is worse than skipping.

Hard rules:
- Engage with the SPECIFIC substance of their post. React to their actual point or ask one genuine question.
- Do NOT pitch, promote, or mention your company, services, clients, results, or revenue.
- NEVER invent or cite statistics, percentages, dollar amounts, or specific outcomes, not about yourself, not about their business. No "we've seen 12-18%", no "$29M", no "studies show".
- Do NOT force an Amazon, PPC, or business angle. Their topic, their terms.
- It is fine, often better, to admit something is outside your expertise and ask a real question instead of asserting authority.
- If the post is casual or funny, match that register. Do not respond to a joke with a structured business observation.
- If the post is short, your comment should be short.

Length and shape:
- Length varies with what you actually have to say. The target shape for THIS comment is: ${lengthShape}.
- A fragment is fine. Starting lowercase is fine. Dropping the final period is fine. Two thoughts joined by a comma instead of a period is fine.
- Do not pad to sound complete. Do not be more formal than the post.

Banned openers and fillers (never use any of these):
"Great point", "Great post", "Love this", "This resonates", "Couldn't agree more", "Such a good reminder", "Thanks for sharing", "100%", "+1", "So true", "Spot on", "Well said", "This!", "Curious to hear more", "I'd love to know more about", "Would love your thoughts".

Banned structures:
- The three-beat "observation, then reframe, then question" pattern. Pick one beat.
- Tricolons (three parallel adjectives or phrases in a row).
- Em-dashes, asterisks, hash characters.

Voice samples (if provided) show vocabulary and register only. Do not match their length, sentence count, or structure. Do not lift any claims, numbers, tactics, or topics from them. Your comment's shape comes from the post you're responding to.

Voice samples:
${samplesBlock}

Voice: ${b.voice}

Output: { "text": "<= 320 chars" } or { "text": "" } to skip.`;
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

    // Candidate posts: uncommented, fresh, with real text, for eligible
    // prospects not in cooldown — best engagement first.
    const freshAgo = new Date(Date.now() - POST_FRESHNESS_DAYS * 86_400_000).toISOString();
    const { data: posts, error: pErr } = await client
      .from("prospect_posts")
      .select("id, prospect_id, account_id, post_id, text, engagement_score, posted_at")
      .eq("commented", false)
      .eq("skipped", false)
      .in("prospect_id", eligibleIds)
      .gte("posted_at", freshAgo)
      .order("engagement_score", { ascending: false })
      .limit(50);
    if (pErr) {
      logger.error("candidate posts fetch failed", { error: pErr.message });
      return { sent: 0, error: pErr.message };
    }

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
            'In one internal sentence, identify what this post is actually about and what your honest reaction is. Then write the comment as that reaction, following the shape and rules in the system prompt. If your honest reaction is "I don\'t really have anything genuine to add here," output {"text": ""}.',
            "",
            `Target shape for this comment: ${lengthShape}.`,
            "",
            "No em-dashes, no asterisks, no hashtags, no banned openers. Do not pitch. Do not mention your own company, clients, or results. Do not invent any numbers.",
          ].join("\n"),
          model: "anthropic/claude-haiku-4-5",
          temperature: randomTemp(),
          maxTokens: 300,
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

      target = p;
      commentText = draft;
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
