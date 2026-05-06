import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// POST /api/competitors/[id]/self — mark this competitor as the "self" row.
// Clears the flag on any other row first so the partial unique index never
// trips. The leaderboard uses this row as the baseline that all deltas are
// computed against.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  // Two-step: clear all true → set this one. Postgres can't atomically swap
  // a partial-unique flag in a single update, so we do it as two
  // statements. Risk window is microseconds — acceptable for an internal
  // tool with one operator.
  const { error: clearErr } = await supabase
    .from("competitors")
    .update({ is_self: false })
    .eq("is_self", true);
  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("competitors")
    .update({ is_self: true })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ competitor: data });
}

// DELETE /api/competitors/[id]/self — clear the self flag on this row
// (de-marks the current self competitor without picking a new one).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("competitors")
    .update({ is_self: false })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ competitor: data });
}
