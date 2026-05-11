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

// DELETE — "skip illustration on this slide".
//
// Use when the slide reads better text-only and the operator doesn't want
// to pick any variant. Without this, the render gate at
// PostStudio.tsx:96 blocks "Render & publish" forever because the slide
// has an image_gen_prompt but no picked variant.
//
// Clears all three pieces of state so the slide reverts to text-only:
//   1. Unpicks any picked variant in post_assets
//   2. Removes the path from angles.slide_image_paths
//   3. Nulls carousel_slides[slideN-1].image_gen_prompt so the render
//      gate no longer demands an image for this slide
//
// Does NOT delete the post_assets rows themselves — keeping the variant
// images around is cheap and lets the operator change their mind later
// by hitting Generate again (which is a no-op fetch if the rows exist).
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string; slideN: string }> },
) {
  const { angleId, slideN } = await ctx.params;
  const slideIndex = Number(slideN);
  if (!Number.isInteger(slideIndex) || slideIndex < 1) {
    return NextResponse.json({ error: "invalid_slide_n" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1. Unpick any current variant for this slide.
  await supabase
    .from("post_assets")
    .update({ picked_at: null })
    .eq("angle_id", angleId)
    .eq("slide_n", slideIndex)
    .not("picked_at", "is", null);

  // 2 + 3. Patch the angle row in one round-trip.
  const { data: angle, error: aErr } = await supabase
    .from("angles")
    .select("slide_image_paths, carousel_slides")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  const paths = { ...((angle.slide_image_paths as Record<string, string> | null) ?? {}) };
  delete paths[String(slideIndex)];

  const slides = [...((angle.carousel_slides as Array<Record<string, unknown>> | null) ?? [])];
  const idx = slideIndex - 1;
  if (slides[idx]) {
    slides[idx] = { ...slides[idx], image_gen_prompt: null };
  }

  const { data: updated, error: upErr } = await supabase
    .from("angles")
    .update({
      slide_image_paths: paths,
      carousel_slides: slides,
      // Render is now stale — last PDF was rendered against the old slide spec.
      carousel_pdf_path: null,
      carousel_rendered_at: null,
    })
    .eq("angle_id", angleId)
    .select()
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ angle: updated });
}
