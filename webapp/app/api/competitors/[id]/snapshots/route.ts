import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/competitors/[id]/snapshots — last 90 days of profile snapshots
// for the side-by-side compare modal's history view.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("competitor_snapshots")
    .select("captured_at, headline, cover_url, cover_thumb_path, followers_count, connections_count")
    .eq("competitor_id", id)
    .gte("captured_at", since)
    .order("captured_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshots: data ?? [] });
}
