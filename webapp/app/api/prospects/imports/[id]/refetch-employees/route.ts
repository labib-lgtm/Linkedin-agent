import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/prospects/imports/[id]/refetch-employees
//
// Lighter-touch retry: keeps every seller's existing company match
// (linkedin_company_urn + url) and just re-runs the employees lookup.
// Used after a Unipile body-shape fix to backfill prospects without
// re-doing the company search step.
//
// Wipes the import's existing prospects but does NOT touch sellers'
// match data. Fires the `refetch-company-employees` task.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  // Ownership check.
  const { data: imp, error: impErr } = await supabase
    .from("seller_imports")
    .select("id, account_id")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (impErr) return NextResponse.json({ error: impErr.message }, { status: 500 });
  if (!imp) return NextResponse.json({ error: "import_not_found" }, { status: 404 });

  // 1. Wipe existing prospects for this import (chunked).
  const { data: sellerIds, error: idsErr } = await supabase
    .from("sellers")
    .select("id")
    .eq("import_id", id);
  if (idsErr) return NextResponse.json({ error: idsErr.message }, { status: 500 });
  const ids = (sellerIds ?? []).map((r) => r.id as string);

  if (ids.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error: delErr } = await supabase
        .from("prospects")
        .delete()
        .in("seller_id", slice);
      if (delErr) {
        return NextResponse.json(
          { error: "prospect_delete_failed", message: delErr.message },
          { status: 500 },
        );
      }
    }
  }

  // 2. Reset the import row (status + clear error so the task can run).
  const { error: impRstErr } = await supabase
    .from("seller_imports")
    .update({
      status: "queued",
      error: null,
      completed_at: null,
    })
    .eq("id", id);
  if (impRstErr) {
    return NextResponse.json(
      { error: "import_reset_failed", message: impRstErr.message },
      { status: 500 },
    );
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    await supabase
      .from("seller_imports")
      .update({ status: "failed", error: "TRIGGER_SECRET_KEY not configured" })
      .eq("id", id);
    return NextResponse.json(
      {
        error: "trigger_not_configured",
        message: "TRIGGER_SECRET_KEY env var missing.",
      },
      { status: 503 },
    );
  }

  try {
    const handle = await tasks.trigger("refetch-company-employees", { importId: id });
    await supabase
      .from("seller_imports")
      .update({ status: "processing" })
      .eq("id", id);
    return NextResponse.json({
      importId: id,
      runId: handle.id,
    });
  } catch (e) {
    await supabase
      .from("seller_imports")
      .update({ status: "failed", error: (e as Error).message })
      .eq("id", id);
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
