import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { parseSegmentBody } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// GET /api/audience/segments → list non-archived segments for the active account
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("target_segments")
    .select(
      "id, name, industries, role_keywords, locations, company_size_min, company_size_max, notes, weekly_quota, invite_template, dm_template, dm_followup_template, daily_send_cap, auto_send, paused_at, pause_reason, created_at",
    )
    .eq("account_id", accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segments: data ?? [] });
}

// POST /api/audience/segments → create a new segment
export async function POST(req: NextRequest) {
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

  const insert: Record<string, unknown> = {
    account_id: accountId,
    name: parsed.name,
    industries: parsed.industries,
    role_keywords: parsed.role_keywords,
    locations: parsed.locations,
    company_size_min: parsed.company_size_min,
    company_size_max: parsed.company_size_max,
    notes: parsed.notes,
    weekly_quota: parsed.weekly_quota,
  };
  if (parsed.invite_template != null) insert.invite_template = parsed.invite_template;
  if (parsed.dm_template != null) insert.dm_template = parsed.dm_template;
  if (parsed.dm_followup_template != null) insert.dm_followup_template = parsed.dm_followup_template;
  if (parsed.daily_send_cap != null) insert.daily_send_cap = parsed.daily_send_cap;
  if (parsed.auto_send != null) insert.auto_send = parsed.auto_send;

  const { data, error } = await supabase
    .from("target_segments")
    .insert(insert)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
