import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// POST /api/prospects/outreach/bulk — enroll many prospects in the
// warm-outreach sequence in one call. Body: { prospect_ids: string[] }.
// Only ids owned by the active account are enrolled; already-enrolled
// prospects are left untouched (ignoreDuplicates) so an in-flight sequence
// is never reset back to 'engaging'.
export async function POST(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  let body: { prospect_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ids = Array.isArray(body.prospect_ids)
    ? Array.from(
        new Set(body.prospect_ids.filter((x): x is string => typeof x === "string")),
      )
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "no_prospect_ids" }, { status: 400 });
  }

  // Keep only prospects that belong to the active account.
  const { data: owned, error: ownErr } = await supabase
    .from("prospects")
    .select("id")
    .eq("account_id", accountId)
    .in("id", ids);
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 });

  const validIds = (owned ?? []).map((p) => p.id);
  if (validIds.length === 0) return NextResponse.json({ enrolled: 0 });

  const rows = validIds.map((prospect_id) => ({
    prospect_id,
    account_id: accountId,
    stage: "engaging",
    paused: false,
  }));

  const { data, error } = await supabase
    .from("prospect_outreach")
    .upsert(rows, { onConflict: "prospect_id", ignoreDuplicates: true })
    .select("prospect_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ enrolled: data?.length ?? 0 });
}
