import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/outreach/[id]/approve — flip status draft → approved. The
// Trigger.dev send_outbound_comments task picks up approved rows on
// its next 30-min cycle, paces at 5/day/account with 2h gaps.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("outbound_comments")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outbound: data });
}
