import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { carouselStructureSystemPrompt, type BrandPalette } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Template = "story" | "list" | "compare" | "framework";
const TEMPLATES: Template[] = ["story", "list", "compare", "framework"];

const DEFAULT_PALETTE: BrandPalette = {
  primary: "#C6F21F",     // lynx-green
  secondary: "#666666",
  accent: "#b8543c",
  ink: "#0e0e0e",
  paper: "#fafafa",
};
const DEFAULT_TYPOGRAPHY = "Sans serif. Strong headlines, tight tracking on display sizes.";

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

type GeneratedSlides = {
  template?: string;
  slide_count?: number;
  slides?: Array<Partial<Slide>>;
};

function buildUserPrompt(angle: Record<string, unknown>, template: Template): string {
  const paragraphs = (angle.body_paragraphs as Array<{ role: string; text: string }> | null) ?? [];
  const body =
    paragraphs.length > 0
      ? paragraphs.map((p) => p.text).join("\n\n")
      : (angle.draft_body as string | null) ?? "";

  return [
    `Template: ${template}`,
    `Pillar: ${angle.pillar ?? "—"}`,
    `Format: ${angle.format ?? "carousel"}`,
    `CTA archetype: ${angle.cta_archetype ?? "click"}`,
    `CTA copy: ${angle.cta_text ?? ""}`,
    `Pin comment (do not put on a slide, just context): ${angle.pin_comment ?? ""}`,
    "",
    "Body draft (use this as the source of truth for slide content):",
    body || "(no body yet)",
    "",
    "Generate the slide spec per the system prompt. Return ONLY the JSON object.",
  ].join("\n");
}

function normalizeSlides(input: GeneratedSlides): Slide[] {
  const raw = input.slides ?? [];
  const cleaned: Slide[] = [];
  raw.forEach((s, i) => {
    if (!s || typeof s.headline !== "string" || !s.headline.trim()) return;
    cleaned.push({
      n: typeof s.n === "number" ? s.n : i + 1,
      role: typeof s.role === "string" ? s.role : "list-item",
      layout: typeof s.layout === "string" ? s.layout : "big-number",
      headline: s.headline.trim(),
      supporting: typeof s.supporting === "string" ? s.supporting.trim() || null : null,
      stat: typeof s.stat === "string" ? s.stat.trim() || null : null,
      visual_element: typeof s.visual_element === "string" ? s.visual_element : "blank",
      color_emphasis: typeof s.color_emphasis === "string" ? s.color_emphasis : "primary",
      image_gen_prompt:
        typeof s.image_gen_prompt === "string" && s.image_gen_prompt.trim()
          ? s.image_gen_prompt.trim()
          : null,
    });
  });
  return cleaned.map((s, i) => ({ ...s, n: i + 1 }));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  try {
    return await handle(req, ctx);
  } catch (e) {
    console.error("[posts/generate-slides] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  let body: { template?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body OK
  }

  const template = TEMPLATES.includes(body.template as Template)
    ? (body.template as Template)
    : "list";

  const { data: angle, error: angleErr } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (angleErr) return NextResponse.json({ error: angleErr.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  if (!angle.body_paragraphs && !angle.draft_body) {
    return NextResponse.json(
      { error: "no_body", message: "Generate copy (Phase A) before slides" },
      { status: 400 },
    );
  }

  // Pull palette + typography from the active account; fall back to
  // brand_color (legacy) for primary if brand_palette isn't set yet.
  let palette = DEFAULT_PALETTE;
  let typography = DEFAULT_TYPOGRAPHY;
  if (angle.account_id) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("brand_palette, brand_typography, brand_color")
      .eq("id", angle.account_id)
      .maybeSingle();
    if (acct) {
      const p = acct.brand_palette as BrandPalette | null;
      if (p && typeof p === "object") {
        palette = { ...DEFAULT_PALETTE, ...p };
      } else if (typeof acct.brand_color === "string") {
        palette = { ...DEFAULT_PALETTE, primary: acct.brand_color };
      }
      if (typeof acct.brand_typography === "string" && acct.brand_typography.trim()) {
        typography = acct.brand_typography;
      }
    }
  }

  let result: GeneratedSlides;
  try {
    result = await generateJson<GeneratedSlides>({
      system: carouselStructureSystemPrompt(palette, typography),
      user: buildUserPrompt(angle as Record<string, unknown>, template),
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.4,
      maxTokens: 2200,
      timeoutMs: 8_000,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    throw e;
  }

  const slides = normalizeSlides(result);
  if (slides.length === 0) {
    return NextResponse.json(
      { error: "no_slides", message: "Model returned zero usable slides" },
      { status: 502 },
    );
  }

  const { data: updated, error: updErr } = await supabase
    .from("angles")
    .update({
      carousel_template: template,
      carousel_slides: slides,
      slides_generated_at: new Date().toISOString(),
    })
    .eq("angle_id", angleId)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ angle: updated, slide_count: slides.length });
}
