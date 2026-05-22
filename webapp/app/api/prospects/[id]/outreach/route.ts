import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Manage a prospect's enrollment in the warm-outreach sequence.
//
//   POST   /api/prospects/[id]/outreach  → enroll (stage 'engaging')
//   DELETE /api/prospects/[id]/outreach  → remove from sequence
//   PATCH  /api/prospects/[id]/outreach  → { paused: boolean }
//
// The prospect_outreach row IS the curated list; tracking + commenting
// tasks only act on enrolled, non-paused prospects.

async function ownedProspect(id: string, accountId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, account_id")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const prospect = await ownedProspect(id, accountId).catch((e) => {
    throw e;
  });
  if (!prospect) return NextResponse.json({ error: "prospect_not_found" }, { status: 404 });

  const { data, error } = await supabase
    .from("prospect_outreach")
    .upsert(
      { prospect_id: id, account_id: accountId, stage: "engaging", paused: false },
      { onConflict: "prospect_id", ignoreDuplicates: false },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outreach: data });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("prospect_outreach")
    .delete()
    .eq("prospect_id", id)
    .eq("account_id", accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { paused?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "paused_boolean_required" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("prospect_outreach")
    .update({ paused: body.paused })
    .eq("prospect_id", id)
    .eq("account_id", accountId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outreach: data });
}
