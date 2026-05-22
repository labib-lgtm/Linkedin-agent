import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type SellerRow = {
  prospects?: { status: string }[] | null;
  [key: string]: unknown;
};

// GET /api/prospects — sellers (with their nested prospects) for the active
// account. Filters: ?import_id=...&status=new|contacted|...&category=...
// Returns ALL sellers for the account; PostgREST caps a single request at
// 1000 rows, so we page through with .range() until the book is exhausted.
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const url = new URL(req.url);
  const importId = url.searchParams.get("import_id");
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");

  const PAGE = 1000;
  let from = 0;
  const all: SellerRow[] = [];
  for (;;) {
    let q = supabase
      .from("sellers")
      .select(
        "*, prospects(id, name, headline, linkedin_url, provider_id, status, notes, created_at, prospect_outreach(stage, paused))",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);

    if (importId) q = q.eq("import_id", importId);
    if (category) q = q.eq("category", category);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const batch = (data ?? []) as SellerRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  // Status filter applies to prospects, not sellers. Apply post-query so
  // sellers with at least one matching prospect surface.
  let sellers: SellerRow[] = all;
  if (status) {
    sellers = sellers
      .map((s) => ({
        ...s,
        prospects: (s.prospects ?? []).filter(
          (p: { status: string }) => p.status === status,
        ),
      }))
      .filter((s) => s.prospects.length > 0);
  }

  return NextResponse.json({ sellers });
}
