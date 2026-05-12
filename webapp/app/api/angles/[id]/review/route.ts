import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/angles/[id]/review
//
// Flips status to "Reviewed" and writes the takeaway (if any) to the
// audit_log table as event_type="post_reviewed" with payload.takeaway.
// Lives on a dedicated route because the generic angle PATCH endpoint
// has a field whitelist and reviewing is multi-write (status + log).
//
// Body:
//   { takeaway?: string }   // optional free-text takeaway, ≤ 1000 chars
//
// 409 if the angle isn't currently in "Posted" — we don't want to flip
// arbitrary statuses to Reviewed by accident.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: { takeaway?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — takeaway is optional.
  }
  const takeaway = (body.takeaway ?? "").trim();
  if (takeaway.length > 1000) {
    return NextResponse.json(
      { error: "takeaway_too_long", message: "Keep the takeaway under 1000 chars." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  const { data: angle, error: fetchErr } = await supabase
    .from("angles")
    .select("status")
    .eq("angle_id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  // Guardrail: only allow Posted → Reviewed via this endpoint. Drag-and-
  // drop on the kanban can still flip arbitrary statuses (it uses the
  // generic PATCH); this dedicated path enforces the workflow.
  if (angle.status !== "Posted" && angle.status !== "Reviewed") {
    return NextResponse.json(
      {
        error: "not_posted",
        message: `Status is '${angle.status}'. A post must be 'Posted' before it can be reviewed.`,
      },
      { status: 409 },
    );
  }

  const { data: updated, error: upErr } = await supabase
    .from("angles")
    .update({ status: "Reviewed" })
    .eq("angle_id", id)
    .select()
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Best-effort audit log entry. If this insert fails we still return
  // success — the status flip is the load-bearing action, the takeaway
  // is a bonus.
  if (takeaway) {
    const { error: logErr } = await supabase.from("audit_log").insert({
      angle_id: id,
      event_type: "post_reviewed",
      payload: { takeaway, source: "studio" },
    });
    if (logErr) {
      console.warn(`[review] audit_log insert failed for ${id}: ${logErr.message}`);
    }
  }

  return NextResponse.json({ angle: updated, takeaway: takeaway || null });
}
