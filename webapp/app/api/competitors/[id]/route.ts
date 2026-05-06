import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { data: competitor, error: cErr } = await supabase
    .from("competitors")
    .select("*")
    .eq("id", id)
    .single();
  if (cErr || !competitor) {
    return NextResponse.json({ error: cErr?.message ?? "not_found" }, { status: 404 });
  }
  const { data: posts, error: pErr } = await supabase
    .from("competitor_posts")
    .select("*")
    .eq("competitor_id", id)
    .order("engagement_score", { ascending: false });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  return NextResponse.json({ competitor, posts: posts ?? [] });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { error } = await supabase.from("competitors").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
