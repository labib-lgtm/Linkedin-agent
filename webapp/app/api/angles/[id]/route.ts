import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STATUS_VALUES } from "@/lib/constants";

const ALLOWED_FIELDS = new Set([
  "status",
  "notes",
  "week_assigned",
  "scheduled_at",
  "draft_body",
  "hook_chosen",
  "cta_keyword",
]);

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    patch[k] = v;
  }

  if (
    typeof patch.status === "string" &&
    !STATUS_VALUES.includes(patch.status as (typeof STATUS_VALUES)[number])
  ) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_allowed_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("angles")
    .update(patch)
    .eq("angle_id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ angle: data });
}
