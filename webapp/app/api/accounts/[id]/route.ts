import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// PATCH /api/accounts/[id] — edit name, brand_color, logo_url, niche_tag.
// Other fields (identifier, provider_id) are derived from the LinkedIn
// profile and shouldn't be hand-edited.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: {
    name?: string;
    brand_color?: string;
    logo_url?: string | null;
    niche_tag?: string | null;
    seed_voice_samples?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.brand_color === "string") patch.brand_color = body.brand_color;
  if ("logo_url" in body) patch.logo_url = body.logo_url || null;
  if ("niche_tag" in body) patch.niche_tag = body.niche_tag || null;
  if ("seed_voice_samples" in body) patch.seed_voice_samples = body.seed_voice_samples || null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 });
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}

// DELETE /api/accounts/[id] — soft delete. Existing competitors / posts /
// digests / angles stay in the DB so historical reports don't break;
// the account simply disappears from pickers and lists.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  // Refuse if this is the only non-archived account — would lock the user
  // out (no fallback for getActiveAccountId).
  const { count } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null);
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "last_account", message: "Can't archive the only active account" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("accounts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
