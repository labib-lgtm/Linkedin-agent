import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// POST /api/outreach/pakistan-cleanup/mark
//
// Body: { id: string, status: 'removed' | 'skipped' | 'pending', reason?: string }
//
// Updates the operator workflow state on one target row. Used by the UI's
// "Mark removed" / "Skip" / "Undo" buttons after the operator clicks
// through LinkedIn's disconnect UI in a new tab.
export async function POST(req: NextRequest) {
  let body: { id?: unknown; status?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : null;
  const status = typeof body.status === "string" ? body.status : null;
  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (!["removed", "skipped", "pending"].includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "removed") update.removed_at = new Date().toISOString();
  if (status === "skipped" && typeof body.reason === "string") {
    update.skipped_reason = body.reason;
  }
  if (status === "pending") {
    // Undo path — clear the audit fields so the row looks fresh.
    update.removed_at = null;
    update.skipped_reason = null;
  }

  const { error } = await supabase
    .from("pakistan_cleanup_targets")
    .update(update)
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
