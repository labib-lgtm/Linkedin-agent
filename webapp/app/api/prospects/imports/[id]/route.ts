import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/prospects/imports/[id] — progress poll endpoint for the import
// dialog. Returns the import row + counts grouped by enrichment_status.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  const { data: imp, error: impErr } = await supabase
    .from("seller_imports")
    .select("*")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (impErr) return NextResponse.json({ error: impErr.message }, { status: 500 });
  if (!imp) return NextResponse.json({ error: "import_not_found" }, { status: 404 });

  const { data: sellers, error: sErr } = await supabase
    .from("sellers")
    .select("enrichment_status")
    .eq("import_id", id);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const summary = { pending: 0, matched: 0, no_match: 0, failed: 0 };
  for (const s of sellers ?? []) {
    const k = s.enrichment_status as keyof typeof summary;
    if (k in summary) summary[k] += 1;
  }

  return NextResponse.json({ import: imp, sellers_summary: summary });
}
