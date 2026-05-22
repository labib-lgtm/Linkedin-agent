import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/prospects/imports/[id]/reenrich
//
// Wipes the import's existing prospects + resets every seller to
// `pending`, then re-fires the enrich-seller-imports Trigger.dev task
// against the same import. Used after the Unipile wrappers change (e.g.
// adding Sales Navigator) to re-process previously-enriched batches
// without re-uploading the CSV.
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

  // 1. Delete prospects for this import (they're linked via seller_id).
  //    Two-step: fetch seller ids, then delete prospects matching them.
  //    Avoids the supabase-js .in() limit on a single chained query.
  const { data: sellerIds, error: idsErr } = await supabase
    .from("sellers")
    .select("id")
    .eq("import_id", id);
  if (idsErr) return NextResponse.json({ error: idsErr.message }, { status: 500 });
  const ids = (sellerIds ?? []).map((r) => r.id as string);

  if (ids.length > 0) {
    // Chunk the delete to avoid URL length limits.
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

  // 2. Reset all sellers in this import.
  const { error: rstErr } = await supabase
    .from("sellers")
    .update({
      enrichment_status: "pending",
      enrichment_error: null,
      linkedin_company_urn: null,
      linkedin_company_url: null,
      enriched_at: null,
    })
    .eq("import_id", id);
  if (rstErr) {
    return NextResponse.json(
      { error: "sellers_reset_failed", message: rstErr.message },
      { status: 500 },
    );
  }

  // 3. Reset the import row itself.
  const { error: impRstErr } = await supabase
    .from("seller_imports")
    .update({
      status: "queued",
      enriched_count: 0,
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

  // 4. Re-fire the enrichment task.
  try {
    const handle = await tasks.trigger("enrich-seller-imports", { importId: id, budget: 200 });
    await supabase
      .from("seller_imports")
      .update({ status: "processing" })
      .eq("id", id);
    return NextResponse.json({
      importId: id,
      runId: handle.id,
      resetCount: ids.length,
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
