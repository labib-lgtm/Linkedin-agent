import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { renderCarouselPdf, type Palette, type Slide } from "./lib/carouselPdf.js";

/**
 * Phase E — render carousel slides to a multi-page PDF.
 *
 * Imperatively triggered from POST /api/posts/[angleId]/render-carousel-pdf.
 * For one angle:
 *   1. Load slides + palette + picked image paths.
 *   2. Build public Storage URLs for each picked image.
 *   3. Render via @react-pdf/renderer to a Buffer.
 *   4. Upload to post-assets/{angleId}/carousel.pdf (overwrite=true).
 *   5. Update angles.carousel_pdf_path + carousel_rendered_at.
 *
 * Output is then attachable to a LinkedIn carousel post via Unipile's
 * media endpoint inside the existing publish flow.
 */

const STORAGE_BUCKET = "post-assets";

const supabase = getServiceClient;

export const renderCarouselPdfTask = task({
  id: "render-carousel-pdf",
  maxDuration: 60 * 5,
  run: async (
    payload: { angleId: string },
    { ctx },
  ): Promise<{ ok: boolean; pdfPath?: string; sizeBytes?: number; error?: string }> => {
    const { angleId } = payload;
    const client = supabase();

    logger.info("rendering carousel PDF", { runId: ctx.run.id, angleId });

    const { data: angle, error: aErr } = await client
      .from("angles")
      .select("account_id, carousel_slides, slide_image_paths")
      .eq("angle_id", angleId)
      .maybeSingle();
    if (aErr || !angle) return { ok: false, error: `angle: ${aErr?.message ?? "not found"}` };

    const slides = (angle.carousel_slides as Slide[] | null) ?? [];
    if (slides.length === 0) return { ok: false, error: "no slides" };
    const slideImagePaths = (angle.slide_image_paths as Record<string, string> | null) ?? {};

    let palette: Palette = {
      primary: "#C6F21F",
      secondary: "#666666",
      accent: "#b8543c",
      ink: "#0e0e0e",
      paper: "#fafafa",
    };
    if (angle.account_id) {
      const { data: acct } = await client
        .from("accounts")
        .select("brand_palette, brand_color")
        .eq("id", angle.account_id as string)
        .maybeSingle();
      if (acct?.brand_palette && typeof acct.brand_palette === "object") {
        palette = { ...palette, ...(acct.brand_palette as Partial<Palette>) };
      } else if (typeof acct?.brand_color === "string") {
        palette.primary = acct.brand_color;
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const pickedImageUrls: Record<string, string> = {};
    for (const [k, p] of Object.entries(slideImagePaths)) {
      pickedImageUrls[k] = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${p}`;
    }

    let pdfBytes: Buffer;
    try {
      pdfBytes = await renderCarouselPdf(slides, palette, pickedImageUrls);
    } catch (e) {
      logger.error("PDF render failed", { error: (e as Error).message });
      return { ok: false, error: `render: ${(e as Error).message}` };
    }

    const path = `${angleId}/carousel.pdf`;
    const { error: upErr } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return { ok: false, error: `upload: ${upErr.message}` };

    const { error: updErr } = await client
      .from("angles")
      .update({
        carousel_pdf_path: path,
        carousel_rendered_at: new Date().toISOString(),
      })
      .eq("angle_id", angleId);
    if (updErr) return { ok: false, error: `update: ${updErr.message}` };

    logger.info("carousel PDF ready", { angleId, path, sizeBytes: pdfBytes.length });
    return { ok: true, pdfPath: path, sizeBytes: pdfBytes.length };
  },
});
