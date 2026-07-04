import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/outreach/pakistan-cleanup/targets?status=pending&limit=500
//
// Lists rows from pakistan_cleanup_targets for the active account.
// Filters:
//   status: pending | removed | skipped | all (default pending)
//   limit:  max rows to return (default 500, cap 2000)
// Also returns { totals } so the UI can render "X pending, Y removed" without
// a second round-trip.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const sp = req.nextUrl.searchParams;
  const status = (sp.get("status") ?? "pending").toLowerCase();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 2000);

  let q = supabase
    .from("pakistan_cleanup_targets")
    .select(
      "id, provider_id, public_identifier, full_name, headline, location, matched_keyword, profile_url, status, removed_at, scanned_at",
    )
    .eq("account_id", accountId)
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Totals for the header ribbon. One head:true per status keeps the query
  // set tiny — no rows shipped over the wire.
  const totals = { pending: 0, removed: 0, skipped: 0 };
  for (const s of ["pending", "removed", "skipped"] as const) {
    const { count } = await supabase
      .from("pakistan_cleanup_targets")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", s);
    totals[s] = count ?? 0;
  }

  return NextResponse.json({ targets: data ?? [], totals });
}
