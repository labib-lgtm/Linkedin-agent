import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const ALLOWED_FIELDS = new Set(["status", "notes"]);
const ALLOWED_STATUSES = new Set([
  "new",
  "contacted",
  "responded",
  "converted",
  "archived",
]);

// PATCH /api/prospects/[id] — update a single prospect's status or notes.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_allowed_fields" }, { status: 400 });
  }

  if (
    typeof patch.status === "string" &&
    !ALLOWED_STATUSES.has(patch.status)
  ) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("prospects")
    .update(patch)
    .eq("id", id)
    .eq("account_id", accountId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prospect: data });
}
