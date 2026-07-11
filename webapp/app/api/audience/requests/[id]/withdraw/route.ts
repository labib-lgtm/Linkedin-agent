import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/requests/[id]/withdraw
//
// Calls Unipile's cancel-invite endpoint (via the webapp-side Unipile
// wrapper), then flips outgoing_invitations.status='withdrawn'. On
// Unipile failure the row is left untouched so a retry works.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { data: invite, error: fetchErr } = await supabase
    .from("outgoing_invitations")
    .select("id, provider_id, status")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!["sent", "pending", "expired"].includes(invite.status as string)) {
    return NextResponse.json({ error: `cannot withdraw a ${invite.status} invitation` }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.reason === "string") reason = body.reason;
  } catch {
    // no body ok
  }

  // Delegate to the trigger cancel path — since it's a single Unipile call
  // with the same env vars available webapp-side, we call it inline instead
  // of firing a background task.
  try {
    const { cancelUnipileInvitation } = await import("@/lib/unipile-cancel");
    await cancelUnipileInvitation(invite.provider_id as string);
  } catch (e) {
    return NextResponse.json(
      { error: "cancel_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  const { error: upErr } = await supabase
    .from("outgoing_invitations")
    .update({
      status: "withdrawn",
      withdrawn_at: new Date().toISOString(),
      withdraw_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
