import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/posts/[angleId]/assets — list all post_assets variants for this
// angle, grouped by slide_n. Used by the studio's variant grid + polling
// after generate-image kicks off a Trigger.dev run.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("post_assets")
    .select("id, slide_n, variant_n, storage_path, brand_score, brand_score_detail, picked_at, generated_at")
    .eq("angle_id", angleId)
    .order("generated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data ?? [] });
}
