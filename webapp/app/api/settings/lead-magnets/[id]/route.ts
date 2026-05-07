import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const ALLOWED_FIELDS = new Set(["label", "url", "description"]);

// PATCH /api/settings/lead-magnets/[id] — edit label / url / description.
// Kind + file_path are immutable post-create (avoids orphaned bucket files
// and ensures the URL stays consistent with the kind).
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
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

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("lead_magnets")
    .update(patch)
    .eq("id", id)
    .eq("account_id", accountId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ magnet: data });
}

// DELETE /api/settings/lead-magnets/[id] — soft archive. Existing angles
// keep their denormalized lead_magnet_url, but the magnet hides from the
// picker.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { error } = await supabase
    .from("lead_magnets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
