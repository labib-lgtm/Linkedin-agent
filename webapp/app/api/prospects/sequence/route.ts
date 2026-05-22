import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/prospects/sequence — enrolled prospects for the active account,
// joined to prospect + seller for display in the Outreach "Prospect
// sequence" tab. Ordered most-recently-enrolled first.
export async function GET() {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  const { data, error } = await supabase
    .from("prospect_outreach")
    .select(
      "id, prospect_id, stage, paused, comments_made, comments_target, last_comment_at, enrolled_at, " +
        "invite_message, invite_approved, invite_sent_at, connected_at, dm_text, dm_approved, dm_sent_at, " +
        "prospect:prospects(id, name, headline, linkedin_url, status, " +
        "seller:sellers(seller_name, brand_name, business_name, linkedin_company_url))",
    )
    .eq("account_id", accountId)
    .order("enrolled_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
