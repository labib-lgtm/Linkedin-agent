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
type DigestPayload = { patterns?: Pattern[]; topics_in_niche?: string[] };

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

export async function runDigest(weekStart?: string) {
  const supabase = createServiceClient();
  const target = weekStart || isoWeekStart(new Date());

  const since = new Date(target + "T00:00:00Z");
  since.setUTCDate(since.getUTCDate() - 7);

  const { data: comps, error: cErr } = await supabase
    .from("competitors")
    .select("id, identifier, display_name, role")
    .eq("active", true);
  if (cErr) throw new DigestError("supabase", cErr.message, 500);
  if (!comps || comps.length === 0) {
    throw new DigestError("no_active_competitors", "Add at least one competitor first", 400);
  }
  const compById: Record<string, CompetitorRow> = Object.fromEntries(
    (comps as CompetitorRow[]).map((c) => [c.id, c]),
  );

  const { data: posts, error: pErr } = await supabase
    .from("competitor_posts")
    .select("competitor_id, post_id, posted_at, text, engagement_score, reactions, comments, reposts")
    .gte("posted_at", since.toISOString())
    .order("engagement_score", { ascending: false });
  if (pErr) throw new DigestError("supabase", pErr.message, 500);

  const top = ((posts as PostRow[] | null) ?? []).slice(0, 30);
  if (top.length === 0) {
    throw new DigestError(
      "no_posts_in_window",
      "No competitor posts in the last 7 days. Run analyze on each competitor first.",
      400,
    );
  }

  const lines = top.map((p, i) => {
    const c = compById[p.competitor_id];
    const url = `https://www.linkedin.com/feed/update/${p.post_id}/`;
    return [
      `--- Post ${i + 1} ---`,
      `Creator: ${c?.display_name || c?.identifier || "unknown"} (role: ${c?.role || "n/a"})`,
      `URL: ${url}`,
      `Score: ${Math.round(Number(p.engagement_score ?? 0))} (likes ${p.reactions ?? 0}, comments ${p.comments ?? 0}, reposts ${p.reposts ?? 0})`,
      `Text: ${(p.text ?? "").slice(0, 1200)}`,
    ].join("\n");
  });

  const summary = await generateJson<DigestPayload>({
    system: SYSTEM,
    user:
      `Week starting ${target}. Top ${top.length} posts across ${comps.length} tracked creators.\n\n` +
      lines.join("\n\n") +
      "\n\nReturn ONLY the JSON object.",
    temperature: 0.4,
    maxTokens: 2000,
  });

  const topPostsJson = top.map((p) => {
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
      excerpt: (p.text ?? "").slice(0, 280),
    };
  });

  const { data: digest, error: upErr } = await supabase
    .from("creator_digests")
    .upsert(
      {
        week_start: target,
        top_posts: topPostsJson,
        pattern_summary: summary,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "week_start" },
    )
    .select()
    .single();
  if (upErr) throw new DigestError("supabase", upErr.message, 500);
  return digest;
}
