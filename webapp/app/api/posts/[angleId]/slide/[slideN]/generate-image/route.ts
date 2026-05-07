import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Imperatively fires the Trigger.dev `generate-slide-images` task. The
// LLM image gen + 4-variant loop blows past Vercel's 10s ceiling, so the
// route only kicks off the run and returns the runId for the studio to
// poll. Real progress lives in the post_assets rows.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string; slideN: string }> },
) {
  const { angleId, slideN } = await ctx.params;
  const slideIndex = Number(slideN);
  if (!Number.isInteger(slideIndex) || slideIndex < 1) {
    return NextResponse.json({ error: "invalid_slide_n" }, { status: 400 });
  }

  // Validate angle has slides + the picked slide has an image_gen_prompt.
  const supabase = createServiceClient();
  const { data: angle, error } = await supabase
    .from("angles")
    .select("carousel_slides")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (error || !angle?.carousel_slides) {
    return NextResponse.json({ error: "no_slides_yet" }, { status: 400 });
  }
  const slides = angle.carousel_slides as Array<{ n: number; image_gen_prompt: string | null }>;
  const slide = slides.find((s) => s.n === slideIndex);
  if (!slide) {
    return NextResponse.json({ error: "slide_out_of_range" }, { status: 400 });
  }
  if (!slide.image_gen_prompt) {
    return NextResponse.json(
      {
        error: "no_image_prompt",
        message:
          "This slide has no image_gen_prompt. Edit the slide and add one (or pick a slide with visual_element = illustration).",
      },
      { status: 400 },
    );
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "trigger_not_configured",
        message:
          "TRIGGER_SECRET_KEY env var missing. Set it in Vercel project settings to invoke the image-gen task.",
      },
      { status: 503 },
    );
  }
  // OPENROUTER_API_KEY is checked inside the Trigger.dev task; if it's
  // missing the run fails with a clear error in the worker logs.

  try {
    const handle = await tasks.trigger("generate-slide-images", {
      angleId,
      slideN: slideIndex,
    });
    return NextResponse.json({ runId: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
