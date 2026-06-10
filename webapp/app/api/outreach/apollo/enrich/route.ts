import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { applySellerFilter, parseFilterFromBody } from "@/lib/apollo-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/outreach/apollo/enrich
//
// Body: { filter: SellerFilter, budget?: number }
// Returns: { count, run_id, estimated_credit_cap }
//
// Resolves the matching seller_ids server-side (so the worker doesn't have
// to re-implement the filter), fires the enrich-apollo-sellers Trigger.dev
// task with the explicit id list + budget.
export async function POST(req: NextRequest) {
  let body: { filter?: unknown; budget?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const filter = parseFilterFromBody(body.filter);
  const budget = Math.max(1, Math.min(Number(body.budget) || 100, 500));

  // Paginated fetch of matching seller ids + statuses.
  const PAGE = 1000;
  const matching: { id: string; status: string }[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from("sellers")
      .select("id, apollo_filter_status")
      .eq("account_id", accountId)
      .range(offset, offset + PAGE - 1);
    q = applySellerFilter(q, filter);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    for (const r of rows) {
      matching.push({
        id: r.id as string,
        status: (r.apollo_filter_status as string | null) ?? "pending",
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 50_000) break;
  }

  // Exclude already enrolled in LinkedIn loop if requested.
  let workSet = matching;
  if (filter.exclude_enrolled) {
    const enrolledIds = await fetchEnrolledSellerIds(supabase);
    workSet = matching.filter((m) => !enrolledIds.has(m.id));
  }

  // Skip sellers we've already classified as dead ends or enriched — they'd
  // be no-ops in the worker anyway, but skipping them here means the run
  // only needs to iterate sellers that could actually spend a credit.
  const actionable = workSet.filter(
    (m) => m.status === "pending" || m.status === "has_employees",
  );

  if (actionable.length === 0) {
    return NextResponse.json({
      count: 0,
      run_id: null,
      estimated_credit_cap: 0,
      message: "Nothing to enrich. All matching sellers are already classified.",
    });
  }

  // Pass the explicit id list to the worker. We don't try to be clever
  // about ordering — the worker processes in whatever order it receives.
  const sellerIds = actionable.map((m) => m.id);

  let runId: string | null = null;
  try {
    const handle = await tasks.trigger("enrich-apollo-sellers", {
      sellerIds,
      budget,
    });
    runId = handle.id;
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  return NextResponse.json({
    count: sellerIds.length,
    run_id: runId,
    estimated_credit_cap: Math.min(budget, sellerIds.length),
  });
}

async function fetchEnrolledSellerIds(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("prospects")
      .select("seller_id")
      .not("seller_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) {
      if (r.seller_id) ids.add(r.seller_id as string);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 50_000) break;
  }
  return ids;
}
