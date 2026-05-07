import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { STATUS_VALUES } from "@/lib/constants";

export const dynamic = "force-dynamic";

// GET /api/posts/[angleId] — fetch the latest angle row. Used by the
// studio's polling loop after firing async tasks (render-carousel-pdf,
// generate-image) so the UI re-renders once the worker writes back.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });
  return NextResponse.json({ angle: data });
}

// Studio-side PATCH for inline edits to a Post Studio angle.
//
// Whitelisted fields cover everything the studio editor exposes plus the
// status flips operated via the Mark drafted button. Whenever
// body_paragraphs changes we recompute draft_body so the existing publish
// path keeps working without changes.

type BodyParagraph = {
  role: "hook" | "setup" | "pivot" | "list" | "payoff" | "cta";
  text: string;
};

const ALLOWED_FIELDS = new Set<string>([
  "selected_hook_index",
  "body_paragraphs",
  "cta_archetype",
  "cta_text",
  "pin_comment",
  "status",
  "hook_chosen",
  "dm_response_template",
  "dm_response_includes_link",
]);

const CTA_ARCHETYPES = new Set(["follow", "comment", "dm", "click", "demo"]);

function joinBody(paragraphs: BodyParagraph[] | undefined | null): string {
  if (!Array.isArray(paragraphs)) return "";
  return paragraphs
    .filter((p) => p && typeof p.text === "string")
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_allowed_fields" }, { status: 400 });
  }

  if (
    typeof patch.status === "string" &&
    !STATUS_VALUES.includes(patch.status as (typeof STATUS_VALUES)[number])
  ) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  if (
    typeof patch.cta_archetype === "string" &&
    !CTA_ARCHETYPES.has(patch.cta_archetype)
  ) {
    return NextResponse.json({ error: "invalid_cta_archetype" }, { status: 400 });
  }

  // Body paragraphs change → re-derive draft_body so publish/route.ts and
  // the digest both see the joined text without any extra work.
  if (Array.isArray(patch.body_paragraphs)) {
    patch.draft_body = joinBody(patch.body_paragraphs as BodyParagraph[]);
  }

  // selected_hook_index change → keep hook_chosen in sync (existing
  // detail page + the kanban card both render hook_chosen).
  if (typeof patch.selected_hook_index === "number") {
    const { data: existing } = await supabase
      .from("angles")
      .select("hook_variants")
      .eq("angle_id", angleId)
      .maybeSingle();
    const variants = existing?.hook_variants as Array<{ text: string }> | null;
    const idx = patch.selected_hook_index as number;
    if (variants && variants[idx]?.text) {
      patch.hook_chosen = variants[idx].text;
    }
  }

  const { data, error } = await supabase
    .from("angles")
    .update(patch)
    .eq("angle_id", angleId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ angle: data });
}
