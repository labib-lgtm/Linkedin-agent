import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Pick a generated image variant for a slide. Clears any prior pick on
// the same slide (only one image per slide ships in the carousel) and
// caches the picked path on angles.slide_image_paths so the slide grid
// + Phase E PDF render can fetch without joining post_assets.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string; slideN: string }> },
) {
  const { angleId, slideN } = await ctx.params;
  const slideIndex = Number(slideN);
  if (!Number.isInteger(slideIndex) || slideIndex < 1) {
    return NextResponse.json({ error: "invalid_slide_n" }, { status: 400 });
  }

  let body: { assetId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.assetId) {
    return NextResponse.json({ error: "asset_id_required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Validate the asset exists and belongs to this slide.
  const { data: asset, error: aErr } = await supabase
    .from("post_assets")
    .select("id, slide_n, storage_path")
    .eq("id", body.assetId)
    .eq("angle_id", angleId)
    .eq("slide_n", slideIndex)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!asset) return NextResponse.json({ error: "asset_not_found" }, { status: 404 });

  const now = new Date().toISOString();

  // Clear any prior pick on this slide.
  await supabase
    .from("post_assets")
    .update({ picked_at: null })
    .eq("angle_id", angleId)
    .eq("slide_n", slideIndex)
    .not("picked_at", "is", null);

  // Mark the new pick.
  const { error: pickErr } = await supabase
    .from("post_assets")
    .update({ picked_at: now })
    .eq("id", body.assetId);
  if (pickErr) return NextResponse.json({ error: pickErr.message }, { status: 500 });

  // Cache the picked path on the angle.
  const { data: angle } = await supabase
    .from("angles")
    .select("slide_image_paths")
    .eq("angle_id", angleId)
    .maybeSingle();
  const cache = (angle?.slide_image_paths as Record<string, string> | null) ?? {};
  cache[String(slideIndex)] = asset.storage_path as string;

  const { data: updated, error: upErr } = await supabase
    .from("angles")
    .update({ slide_image_paths: cache })
    .eq("angle_id", angleId)
    .select()
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ angle: updated, picked: { ...asset, picked_at: now } });
}
