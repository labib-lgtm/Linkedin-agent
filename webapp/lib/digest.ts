import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson } from "@/lib/openrouter";
import { isoWeekStart } from "@/lib/week";

const SYSTEM = `You are a pattern-extraction analyst for Lynx Media's LinkedIn growth system. Given the top-performing posts from a set of tracked LinkedIn creators this week, extract reusable HOOK + FORMAT patterns we can adapt to Amazon PPC topics.

Important: extract STRUCTURE (hook formula, post format, CTA pattern) — not topics. Topics belong to those creators' niches. We want abstractions we can apply to our own.

Return strict JSON:
{
  "patterns": [
    {
      "name": "Short pattern name (3-6 words)",
      "description": "One sentence: how the pattern works structurally. Operator-grade language.",
      "example_post_url": "URL of the example post (must be one we sent you).",
      "applies_to_format": "text" | "carousel" | "image" | "video" | "poll"
    }
  ],
  "topics_in_niche": [
    "Bullet of an Amazon-niche topic getting traction this week (only include if a sender's role was 'direct')."
  ]
}

Rules:
- 3 to 6 patterns. Distinct, not rephrased duplicates.
- Names are punchy and reusable.
- description must be replicable, not just descriptive.
- No em-dashes, asterisks, or hash characters in any string.`;

type Pattern = {
  name?: string;
  description?: string;
  example_post_url?: string;
  applies_to_format?: string;
};
export type DigestPatternSummary = { patterns?: Pattern[]; topics_in_niche?: string[] };

type CompetitorRow = {
  id: string;
  identifier: string;
  display_name: string | null;
  role: string;
};

type PostRow = {
  competitor_id: string;
  post_id: string;
  posted_at: string | null;
  text: string | null;
  engagement_score: number | string | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
};

export class DigestError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Race a thenable against a timeout so a hung Supabase call can't push the
// whole route past Vercel's 10s function ceiling. Critical: clear the
// timer when the original promise wins, otherwise the pending setTimeout
// keeps Node's event loop alive after the response is sent and Vercel
// waits for it to fire — burning the rest of the maxDuration budget for
// no reason.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DigestError("timeout", `${label} timed out after ${ms}ms`, 504));
    }, ms);
    timer.unref?.();
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type DigestTopPost = {
  post_id: string;
  competitor_id: string;
  creator: string | undefined;
  role: string | undefined;
  score: number;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  posted_at: string | null;
  excerpt: string;
};

// Reads-only payload — what comes back from /api/digest/run. Keeps the
// raw LLM prompt material so /summarize doesn't have to re-query.
export type DigestReadOut = {
  week_start: string;
  top_posts: DigestTopPost[];
  llm_input: string;
  comps_count: number;
  generated_at: string;
};

// Full payload after summarize, ready to persist.
export type DigestPayloadOut = {
  week_start: string;
  top_posts: DigestTopPost[];
  pattern_summary: DigestPatternSummary;
  generated_at: string;
};

// Phase 1: DB reads only. No LLM call. Returns the prepared prompt body
// so /summarize can hand it to OpenRouter. Splitting reads from the LLM
// gives each phase its own 10s budget on Vercel Hobby — the LLM call
// alone was eating enough budget to break the combined route even after
// timer fixes.
export async function prepareDigest(weekStart?: string): Promise<DigestReadOut> {
  const supabase = createServiceClient();
  const target = weekStart || isoWeekStart(new Date());

  const since = new Date(target + "T00:00:00Z");
  since.setUTCDate(since.getUTCDate() - 7);

  const t0 = Date.now();

  const { data: comps, error: cErr } = await withTimeout(
    supabase
      .from("competitors")
      .select("id, identifier, display_name, role")
      .eq("active", true),
    2_000,
    "competitors read",
  );
  if (cErr) throw new DigestError("supabase", cErr.message, 500);
  if (!comps || comps.length === 0) {
    throw new DigestError("no_active_competitors", "Add at least one competitor first", 400);
  }
  const compById: Record<string, CompetitorRow> = Object.fromEntries(
    (comps as CompetitorRow[]).map((c) => [c.id, c]),
  );

  const { data: posts, error: pErr } = await withTimeout(
    supabase
      .from("competitor_posts")
      .select(
        "competitor_id, post_id, posted_at, text, engagement_score, reactions, comments, reposts",
      )
      .gte("posted_at", since.toISOString())
      .order("engagement_score", { ascending: false }),
    2_500,
    "posts read",
  );
  if (pErr) throw new DigestError("supabase", pErr.message, 500);

  const top = ((posts as PostRow[] | null) ?? []).slice(0, 12);
  if (top.length === 0) {
    throw new DigestError(
      "no_posts_in_window",
      "No competitor posts in the last 7 days. Run analyze on each competitor first.",
      400,
    );
  }

  console.info("[digest] fetched", { comps: comps.length, top: top.length, ms: Date.now() - t0 });

  const lines = top.map((p, i) => {
    const c = compById[p.competitor_id];
    return [
      `--- Post ${i + 1} ---`,
      `Creator: ${c?.display_name || c?.identifier || "unknown"} (role: ${c?.role || "n/a"})`,
      `URL: https://www.linkedin.com/feed/update/${p.post_id}/`,
      `Score: ${Math.round(Number(p.engagement_score ?? 0))} (likes ${p.reactions ?? 0}, comments ${p.comments ?? 0}, reposts ${p.reposts ?? 0})`,
      `Text: ${(p.text ?? "").slice(0, 500)}`,
    ].join("\n");
  });

  const llm_input =
    `Week starting ${target}. Top ${top.length} posts across ${comps.length} tracked creators.\n\n` +
    lines.join("\n\n") +
    "\n\nReturn ONLY the JSON object.";

  const topPostsJson: DigestTopPost[] = top.map((p) => {
    const c = compById[p.competitor_id];
    return {
      post_id: p.post_id,
      competitor_id: p.competitor_id,
      creator: c?.display_name || c?.identifier,
      role: c?.role,
      score: Math.round(Number(p.engagement_score ?? 0)),
      reactions: p.reactions,
      comments: p.comments,
      reposts: p.reposts,
      posted_at: p.posted_at,
      excerpt: (p.text ?? "").slice(0, 200),
    };
  });

  return {
    week_start: target,
    top_posts: topPostsJson,
    llm_input,
    comps_count: comps.length,
    generated_at: new Date().toISOString(),
  };
}

// Phase 2: just the LLM call. Owns its own 10s budget. If pattern
// extraction fails the caller can still save the digest with empty
// patterns — better to ship the top posts than block the whole digest
// on the model.
export async function summarizeDigest(read: DigestReadOut): Promise<DigestPatternSummary> {
  const t0 = Date.now();
  const summary = await generateJson<DigestPatternSummary>({
    system: SYSTEM,
    user: read.llm_input,
    temperature: 0.4,
    maxTokens: 900,
  });
  console.info("[digest] summarized", { ms: Date.now() - t0 });
  return summary;
}

// Cron path: combine all three phases. The cron invocation has the same
// 10s ceiling, but cron is allowed to fail and retry — UI flow can't.
export async function runDigest(weekStart?: string) {
  const read = await prepareDigest(weekStart);
  const summary = await summarizeDigest(read);
  const payload: DigestPayloadOut = {
    week_start: read.week_start,
    top_posts: read.top_posts,
    pattern_summary: summary,
    generated_at: read.generated_at,
  };
  await saveDigest(payload);
  return payload;
}

// Phase 3: just the upsert. Trivially fits in 10s on its own.
export async function saveDigest(payload: DigestPayloadOut) {
  const supabase = createServiceClient();
  const t0 = Date.now();
  const { error } = await withTimeout(
    supabase
      .from("creator_digests")
      .upsert(
        {
          week_start: payload.week_start,
          top_posts: payload.top_posts,
          pattern_summary: payload.pattern_summary,
          generated_at: payload.generated_at,
        },
        { onConflict: "week_start" },
      ),
    8_000,
    "creator_digests upsert",
  );
  if (error) throw new DigestError("supabase", error.message, 500);
  console.info("[digest] saved", { ms: Date.now() - t0 });
  return { week_start: payload.week_start };
}
