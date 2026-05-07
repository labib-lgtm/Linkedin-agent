import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// PATCH a single slide inside angles.carousel_slides JSONB.
// Whitelisted fields are the editable surface in the slide drawer.

type Slide = {
  n: number;
  role: string;
  layout: string;
  headline: string;
  supporting: string | null;
  stat: string | null;
  visual_element: string;
  color_emphasis: string;
  image_gen_prompt: string | null;
};

const ALLOWED = new Set<string>([
  "headline",
  "supporting",
  "stat",
  "role",
  "layout",
  "visual_element",
  "color_emphasis",
  "image_gen_prompt",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string; slideN: string }> },
) {
  const { angleId, slideN } = await ctx.params;
  const idx = Number(slideN) - 1;
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "invalid_slide_n" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: angle, error: aErr } = await supabase
    .from("angles")
    .select("carousel_slides")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!angle?.carousel_slides) {
    return NextResponse.json({ error: "no_slides_yet" }, { status: 400 });
  }
  const slides = angle.carousel_slides as Slide[];
  if (idx >= slides.length) {
    return NextResponse.json({ error: "slide_out_of_range" }, { status: 400 });
  }

  const next: Slide = { ...slides[idx] };
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) continue;
    // Empty strings → null for nullable fields.
    if (k === "supporting" || k === "stat" || k === "image_gen_prompt") {
      (next as Record<string, unknown>)[k] = typeof v === "string" && v.trim() ? v.trim() : null;
    } else if (typeof v === "string") {
      (next as Record<string, unknown>)[k] = v;
    }
  }

  const updatedSlides = [...slides];
  updatedSlides[idx] = next;

  const { data, error } = await supabase
    .from("angles")
    .update({ carousel_slides: updatedSlides })
    .eq("angle_id", angleId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ angle: data });
}
