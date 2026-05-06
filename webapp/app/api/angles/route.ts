import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { STATUS_VALUES } from "@/lib/constants";
import { getActiveAccountId } from "@/lib/active-account";

const ALLOWED_FIELDS = new Set([
  "angle_id",
  "status",
  "pillar",
  "format",
  "hook_seed",
  "cta_keyword",
  "week_assigned",
  "notes",
]);

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.angle_id !== "string" || !body.angle_id.trim()) {
    return NextResponse.json({ error: "angle_id_required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) insert[k] = v;
  }

  if (
    typeof insert.status === "string" &&
    !STATUS_VALUES.includes(insert.status as (typeof STATUS_VALUES)[number])
  ) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("angles")
    .insert({ ...insert, account_id: accountId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ angle: data });
}
