import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// POST /api/competitors/[id]/self — mark this competitor as the "self" row
// for its account. Clears the flag on any other row in the same account
// first so the per-account partial unique index never trips. The
// leaderboard uses this row as the baseline that all deltas are computed
// against.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  // Look up the competitor's account so we only clear self flags within
  // the same account. Cross-account leakage would be nonsensical.
  const { data: target, error: lookupErr } = await supabase
    .from("competitors")
    .select("id, account_id")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Two-step: clear all true in this account → set this one. Postgres
  // can't atomically swap a partial-unique flag in a single update.
  const { error: clearErr } = await supabase
    .from("competitors")
    .update({ is_self: false })
    .eq("account_id", target.account_id)
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
