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
    .select("id, name, industries, role_keywords, locations, company_size_min, company_size_max, notes, weekly_quota, created_at")
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

  const { data, error } = await supabase
    .from("target_segments")
    .insert({
      account_id: accountId,
      ...parsed,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
