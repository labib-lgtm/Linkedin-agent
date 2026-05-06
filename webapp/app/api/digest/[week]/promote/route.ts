import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function patternId(name: string): string {
  // Slug-style id, capped, with a short random suffix for uniqueness.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "pattern";
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ week: string }> },
) {
  await ctx.params; // week is informational; pattern goes into the global table
  let body: {
    pattern?: { name?: string; description?: string; example_post_url?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = body.pattern?.name?.trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("patterns")
    .insert({
      pattern_id: patternId(name),
      name,
      description: body.pattern?.description?.trim() || null,
      example_post_url: body.pattern?.example_post_url?.trim() || null,
      active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pattern: data });
}
