import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/own-snapshots?days=90 → time series for the top-of-Tab-1 chart
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 90, 7), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("own_account_snapshots")
    .select("captured_at, followers_count, connections_count")
    .eq("account_id", accountId)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ series: data ?? [] });
}
