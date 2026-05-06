import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/accounts/[id]/change-events — last 30 days of profile change
// events for an account. Drives InsightBanner card #2 (positioning shifts)
// and the snapshot strip's "Xd ago" timestamps.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("profile_change_events")
    .select("id, competitor_id, detected_at, kind, before_value, after_value, diff_score")
    .eq("account_id", id)
    .gte("detected_at", since)
    .order("detected_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
