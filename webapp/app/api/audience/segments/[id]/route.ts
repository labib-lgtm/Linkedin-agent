import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { parseSegmentBody } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// PATCH /api/audience/segments/[id] → update fields on an existing segment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseSegmentBody(body);
  if (!parsed) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { error } = await supabase
    .from("target_segments")
    .update({
      ...parsed,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/audience/segments/[id] → soft-archive (preserves history)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("target_segments")
    .update({ archived_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
