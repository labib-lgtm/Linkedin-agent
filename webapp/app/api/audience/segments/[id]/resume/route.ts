import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// POST /api/audience/segments/[id]/resume
//
// Clears paused_at + pause_reason on a segment. The daily
// source-audience-candidates task auto-pauses on low acceptance rate;
// resume is manual on purpose — auto-resume would defeat the safety gate.
// The operator reviews the pause reason, tweaks templates or filters,
// then clicks Resume.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("target_segments")
    .update({
      paused_at: null,
      pause_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
