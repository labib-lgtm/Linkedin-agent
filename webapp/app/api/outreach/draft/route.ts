import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { commentReplySystemPrompt } from "@/lib/prompts";
import { getVoiceSamples } from "@/lib/voice";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// POST /api/outreach/draft
//
// Body: { competitor_post_id: string }
//
// Generates a comment draft for a competitor post and inserts an
// outbound_comments row with status='draft'. Operator approves later.
export async function POST(req: NextRequest) {
  let body: { competitor_post_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const competitorPostId = body.competitor_post_id;
  if (!competitorPostId) {
    return NextResponse.json({ error: "competitor_post_id_required" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { data: post, error: pErr } = await supabase
    .from("competitor_posts")
    .select("post_id, competitor_id, text, engagement_score, posted_at")
    .eq("post_id", competitorPostId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!post) return NextResponse.json({ error: "post_not_found" }, { status: 404 });

  const [business, samples] = await Promise.all([
    getBusinessProfile(),
    getVoiceSamples(accountId, 3),
  ]);

  let result: { text?: string };
  try {
    result = await generateJson<{ text?: string }>({
      system: commentReplySystemPrompt(business, samples),
      user: [
        "Original post (do NOT reply to a comment, just to this post):",
        (post.text as string | null) ?? "(no text)",
        "",
        "Write a 1-3 sentence comment that adds value (specific number, named tactic, named tool, named outcome). Match voice samples.",
      ].join("\n"),
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.6,
      maxTokens: 400,
      timeoutMs: 8_000,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "draft_failed", message: (e as Error).message },
      { status: 500 },
    );
  }

  const text = (result.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty_draft" }, { status: 502 });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("outbound_comments")
    .upsert(
      {
        account_id: accountId,
        competitor_post_id: post.post_id,
        competitor_id: post.competitor_id,
        draft_comment: text,
        status: "draft",
        generated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,competitor_post_id" },
    )
    .select()
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ outbound: inserted });
}
