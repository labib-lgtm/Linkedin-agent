import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { parseSegmentBody } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// PATCH /api/audience/segments/[id] → update fields on an existing segment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseSegmentBody(body);
  if (!parsed) return NextResponse.json({ error: "name required" }, { status: 400 });

  // Drop null-valued outbound fields so a PATCH that doesn't touch them
  // doesn't overwrite whatever the segment already had. Non-null values
  // (including empty strings for template clears) still land.
  const update: Record<string, unknown> = {
    name: parsed.name,
    industries: parsed.industries,
    role_keywords: parsed.role_keywords,
    locations: parsed.locations,
    company_size_min: parsed.company_size_min,
    company_size_max: parsed.company_size_max,
    notes: parsed.notes,
    weekly_quota: parsed.weekly_quota,
    updated_at: new Date().toISOString(),
  };
  if (parsed.invite_template != null) update.invite_template = parsed.invite_template;
  if (parsed.dm_template != null) update.dm_template = parsed.dm_template;
  if (parsed.dm_followup_template != null) update.dm_followup_template = parsed.dm_followup_template;
  if (parsed.daily_send_cap != null) update.daily_send_cap = parsed.daily_send_cap;
  if (parsed.auto_send != null) update.auto_send = parsed.auto_send;

  const { error } = await supabase
    .from("target_segments")
    .update(update)
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/audience/segments/[id] → soft-archive (preserves history)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("target_segments")
    .update({ archived_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
