import { logger, task } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import {
  assembleDrafterlessPrompt,
  assembleImagePrompt,
  generatePostImages,
  joinBodyParagraphs,
  stripRoleLabels,
} from "./lib/imagegen.js";
import { brandConsistencyScore, type Palette } from "./lib/brandcheck.js";

/**
 * Phase C — per-slide image generation.
 *
 * Imperatively triggered from POST /api/posts/[angleId]/slide/[slideN]/generate-image.
 * For one (angleId, slideN):
 *   1. Load angle + account brand prefix + palette + slide spec.
 *   2. Assemble final prompt = brand_prompt_prefix + slide.image_gen_prompt
 *      + composition + mood.
 *   3. Call gpt-image-1 with n=4 → 4 variants.
 *   4. For each variant: upload bytes to post-assets/{angleId}/{slideN}/
 *      {variantN}-{timestamp}.png, run deterministic brand check
 *      (sharp dominant-color → LAB Delta E vs palette), insert
 *      post_assets row.
 *   5. Return summary; the studio then polls /assets to render the
 *      variant grid.
 */

const STORAGE_BUCKET = "post-assets";

type Slide = {
  n: number;
  headline: string;
  supporting: string | null;
  stat: string | null;
  image_gen_prompt: string | null;
  visual_element: string;
};

const supabase = getServiceClient;

export const generateSlideImages = task({
  id: "generate-slide-images",
  maxDuration: 60 * 10, // 10 min — 4 variants × ~30 s + brand checks fits comfortably
  run: async (
    payload: { angleId: string; slideN: number },
    { ctx },
  ): Promise<{
    ok: boolean;
    angleId: string;
    slideN: number;
    variants: number;
    error?: string;
  }> => {
    const { angleId, slideN } = payload;
    const client = supabase();

    logger.info("starting slide image gen", { runId: ctx.run.id, angleId, slideN });

    const { data: angle, error: aErr } = await client
      .from("angles")
      .select("account_id, carousel_slides, format, body_paragraphs, draft_body, hook_chosen, hook_seed")
      .eq("angle_id", angleId)
      .maybeSingle();
    if (aErr || !angle) {
      return { ok: false, angleId, slideN, variants: 0, error: `angle: ${aErr?.message ?? "not found"}` };
    }

    const slides = (angle.carousel_slides as Slide[] | null) ?? [];
    const slide = slides.find((s) => s.n === slideN);
    if (!slide) {
      return { ok: false, angleId, slideN, variants: 0, error: "slide not found" };
    }

    const accountId = angle.account_id as string;
    const { data: acct } = await client
      .from("accounts")
      .select("brand_prompt_prefix, brand_palette, brand_color")
      .eq("id", accountId)
      .maybeSingle();

    const brandPrefix = (acct?.brand_prompt_prefix as string | null) ?? "";
    const palette: Palette = {
      primary: "#C6F21F",
      secondary: "#666666",
      accent: "#b8543c",
      ink: "#0e0e0e",
      paper: "#fafafa",
      ...(((acct?.brand_palette as Partial<Palette> | null) ?? {})),
    };
    if (!acct?.brand_palette && acct?.brand_color) palette.primary = acct.brand_color as string;

    // Pass the palette + format-aware mode. Carousel slides stay
    // strict editorial illustration; single-image posts get the
    // cinematic / mixed-media baseline that allows text + UI + dual-
    // state compositions.
    const mode: "carousel" | "single-image" =
      angle.format === "carousel" ? "carousel" : "single-image";

    // Two paths:
    //   1. OVERRIDE — slide.image_gen_prompt is set (manually written
    //      OR drafted via the Sonnet 4 drafter). Use it verbatim.
    //   2. DRAFTERLESS — image_gen_prompt is empty. Derive the input
    //      from the post body (image format) or from the slide's
    //      headline+supporting+stat (carousel format) and send
    //      directly to the image model with brand framing.
    const overridePrompt = (slide.image_gen_prompt ?? "").trim();
    const useOverride = overridePrompt.length > 10;

    let finalPrompt: string;
    if (useOverride) {
      finalPrompt = assembleImagePrompt(brandPrefix, overridePrompt, palette, { mode });
    } else {
      const postBodyRaw =
        mode === "carousel"
          ? // Carousel — use the slide's content as the body fragment
            // so each slide produces its own targeted image.
            [slide.headline, slide.supporting, slide.stat]
              .filter((s): s is string => typeof s === "string" && !!s.trim())
              .join("\n\n")
          : // Single image — use the full post body so the image model
            // picks the strongest metaphor from the whole post.
            joinBodyParagraphs(
              angle.body_paragraphs as Array<{ role?: string; text?: string }> | null,
            ) || (angle.draft_body as string | null) || "";
      const cleaned = stripRoleLabels(postBodyRaw);
      if (!cleaned || cleaned.length < 10) {
        return {
          ok: false,
          angleId,
          slideN,
          variants: 0,
          error:
            "no source text for drafterless image gen — generate copy (or fill the slide) first",
        };
      }
      finalPrompt = assembleDrafterlessPrompt({
        postBody: cleaned,
        brandPrefix,
        palette,
        mode,
      });
    }
    logger.info("image gen prompt selected", {
      path: useOverride ? "override" : "drafterless",
      promptChars: finalPrompt.length,
    });

    // Image model from app_settings (openrouter.image_model). Fall back
    // to the lib's default when unset.
    let modelOverride: string | undefined = undefined;
    try {
      const { data: settings } = await client
        .from("app_settings")
        .select("values")
        .eq("id", 1)
        .maybeSingle();
      const val = (settings?.values as Record<string, string> | null)?.["openrouter.image_model"];
      if (typeof val === "string" && val.trim()) modelOverride = val.trim();
    } catch {
      // app_settings table missing — env var fallback handles it.
    }

    let variants;
    try {
      variants = await generatePostImages(finalPrompt, {
        n: 4,
        model: modelOverride,
      });
    } catch (e) {
      logger.error("image gen failed", { error: (e as Error).message });
      return { ok: false, angleId, slideN, variants: 0, error: `gen: ${(e as Error).message}` };
    }

    let inserted = 0;
    const ts = Date.now();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const path = `${angleId}/${slideN}/${i}-${ts}.png`;
      const { error: upErr } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(path, v.bytes, { contentType: v.mime, upsert: false });
      if (upErr) {
        logger.warn("variant upload failed", { variant: i, error: upErr.message });
        continue;
      }

      let score = null;
      let detail = null;
      try {
        const sc = await brandConsistencyScore(v.bytes, palette);
        score = sc.brand_score;
        detail = sc;
      } catch (e) {
        logger.warn("brand score failed", { variant: i, error: (e as Error).message });
      }

      const { error: insErr } = await client.from("post_assets").insert({
        angle_id: angleId,
        account_id: accountId,
        slide_n: slideN,
        variant_n: i,
        storage_path: path,
        brand_score: score,
        brand_score_detail: detail,
      });
      if (insErr) {
        logger.warn("post_assets insert failed", { variant: i, error: insErr.message });
        continue;
      }
      inserted += 1;
    }

    logger.info("slide image gen complete", { angleId, slideN, inserted });
    return { ok: inserted > 0, angleId, slideN, variants: inserted };
  },
});
