import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import {
  applySellerFilter,
  parseFilterFromSearchParams,
} from "@/lib/apollo-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/outreach/apollo/preview?...filters
//
// Returns the seller-count breakdown the UI shows above the Enrich button:
//   { total, by_status, credit_cap_estimate }
//
// credit_cap_estimate = number of sellers that would consume a credit if
// the user clicked Enrich right now (status='pending' + status='has_employees'
// that have not yet been enriched). The worker caps at ABSOLUTE_BUDGET_CAP,
// so this is just an upper-bound preview the operator sees ahead of time.
//
// We avoid the .in()/.not().in() PostgREST URL-length trap by fetching the
// enrolled-seller id set in JS and excluding client-side after paginating
// the seller rows.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const filter = parseFilterFromSearchParams(req.nextUrl.searchParams);

  // Paginated fetch of matching sellers (id + status only — small payload).
  const PAGE = 1000;
  const matchingIds: string[] = [];
  const matchingStatuses: string[] = [];
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
      matchingIds.push(r.id as string);
      matchingStatuses.push((r.apollo_filter_status as string | null) ?? "pending");
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 50_000) break; // safety cap
  }

  // Exclude sellers already enrolled in the LinkedIn loop if requested.
  let keptIds = matchingIds;
  let keptStatuses = matchingStatuses;
  if (filter.exclude_enrolled) {
    const enrolledIds = await fetchEnrolledSellerIds(supabase);
    const keep: string[] = [];
    const keepStatus: string[] = [];
    for (let i = 0; i < matchingIds.length; i++) {
      if (!enrolledIds.has(matchingIds[i])) {
        keep.push(matchingIds[i]);
        keepStatus.push(matchingStatuses[i]);
      }
    }
    keptIds = keep;
    keptStatuses = keepStatus;
  }

  const by_status: Record<string, number> = {
    pending: 0,
    has_employees: 0,
    no_employees: 0,
    no_org_match: 0,
    enriched: 0,
    failed: 0,
  };
  for (const s of keptStatuses) {
    by_status[s] = (by_status[s] ?? 0) + 1;
  }

  const credit_cap_estimate = (by_status.pending ?? 0) + (by_status.has_employees ?? 0);

  return NextResponse.json({
    total: keptIds.length,
    by_status,
    credit_cap_estimate,
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
