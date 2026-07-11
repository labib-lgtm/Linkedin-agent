import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/segments/[id]/enqueue
// Body: { provider_id, full_name?, headline?, note? }
//
// Adds a row to outgoing_invitations with status='sent'. Enforces the
// 100/week global cap across all segments so LinkedIn's safety window
// isn't blown. Does NOT actually call Unipile /users/invite — that's a
// separate concern (the existing send-prospect-invites task or a future
// send-audience-invites task will consume from this queue).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: segmentId } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  let body: {
    provider_id?: unknown;
    full_name?: unknown;
    headline?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const providerId = typeof body.provider_id === "string" ? body.provider_id : null;
  if (!providerId) return NextResponse.json({ error: "provider_id required" }, { status: 400 });

  // Enforce the global 100/week cap on outgoing invites.
  const weekStart = new Date();
  const day = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - ((day + 6) % 7));
  weekStart.setUTCHours(0, 0, 0, 0);
  const { count: sentThisWeek } = await supabase
    .from("outgoing_invitations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("sent_at", weekStart.toISOString());
  if ((sentThisWeek ?? 0) >= 100) {
    return NextResponse.json({ error: "weekly_cap_reached" }, { status: 429 });
  }

  const { error } = await supabase
    .from("outgoing_invitations")
    .insert({
      account_id: accountId,
      provider_id: providerId,
      full_name: typeof body.full_name === "string" ? body.full_name : null,
      headline: typeof body.headline === "string" ? body.headline : null,
      note: typeof body.note === "string" ? body.note : null,
      segment_id: segmentId,
      status: "sent",
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sent_this_week: (sentThisWeek ?? 0) + 1 });
}
