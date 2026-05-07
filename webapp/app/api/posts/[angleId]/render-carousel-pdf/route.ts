import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// POST /api/posts/[angleId]/render-carousel-pdf
//
// Validates the angle has slides + every illustrated slide has a
// picked image, then fires the Trigger.dev render-carousel-pdf task.
// Returns the runId so the studio can poll for completion.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  const { data: angle, error } = await supabase
    .from("angles")
    .select("carousel_slides, slide_image_paths")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!angle?.carousel_slides) {
    return NextResponse.json({ error: "no_slides" }, { status: 400 });
  }

  type Slide = { n: number; image_gen_prompt: string | null };
  const slides = angle.carousel_slides as Slide[];
  const paths = (angle.slide_image_paths as Record<string, string> | null) ?? {};
  const missing = slides
    .filter((s) => s.image_gen_prompt && !paths[String(s.n)])
    .map((s) => s.n);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "missing_picks",
        message: `Pick an image for slide(s): ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "trigger_not_configured", message: "TRIGGER_SECRET_KEY env var missing" },
      { status: 503 },
    );
  }

  try {
    const handle = await tasks.trigger("render-carousel-pdf", { angleId });
    return NextResponse.json({ runId: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}
