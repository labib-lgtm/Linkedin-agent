import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/prospects — sellers (with their nested prospects) for the active
// account. Filters: ?import_id=...&status=new|contacted|...&category=...
// Returns up to 200 sellers per call (matches the default pilot batch).
export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const url = new URL(req.url);
  const importId = url.searchParams.get("import_id");
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");

  let q = supabase
    .from("sellers")
    .select(
      "*, prospects(id, name, headline, linkedin_url, provider_id, status, notes, created_at)",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (importId) q = q.eq("import_id", importId);
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Status filter applies to prospects, not sellers. Apply post-query so
  // sellers with at least one matching prospect surface.
  let sellers = data ?? [];
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
