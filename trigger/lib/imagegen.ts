/**
 * Image generation via OpenRouter.
 *
 * OpenRouter supports image-output models through the standard
 * chat-completions endpoint with `modalities: ["image", "text"]`.
 * The response carries the generated image as base64 inside
 * `choices[0].message.images[0].image_url.url`.
 *
 * Reuses OPENROUTER_API_KEY (already set in Trigger.dev env from
 * Compare v2's analyze_posts task) — no separate OPENAI_API_KEY needed.
 *
 * Default model: google/gemini-2.5-flash-image-preview (cheap, fast,
 * good quality for editorial illustration). Override per call by
 * passing `model`, or globally via the openrouter.image_model setting
 * (read by callers from the app_settings table; passed in here).
 *
 * Variants: chat-completions doesn't support n>1 for image output
 * across providers reliably, so we issue parallel calls — 4 promises
 * fired concurrently → ~same wall-clock as one call, 4× cost. The
 * payment is on per-image basis anyway.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// gpt-image-1 follows negative constraints and "no text in image"
// rules better than gemini-flash-image-preview, which tended to
// render text labels on dashboards regardless of NEGATIVE blocks.
// Override per-account via the openrouter.image_model setting.
const DEFAULT_MODEL = "openai/gpt-image-1";

export type GeneratedVariant = {
  bytes: Uint8Array;
  mime: string;
};

export class ImageGenError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ImageGenError";
    this.status = status;
    this.body = body;
  }
}

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

type ChatMessage = {
  content?: string | null;
  images?: Array<{ type?: string; image_url?: { url?: string } }>;
};

type ChatChoice = { message?: ChatMessage };
type ChatResponse = { choices?: ChatChoice[] };

async function callOnce(prompt: string, model: string, timeoutMs: number): Promise<GeneratedVariant | null> {
  const apiKey = env("OPENROUTER_API_KEY");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  t.unref?.();

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lynxmedia.co",
        "X-Title": "LinkedIn Agent",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new ImageGenError(
        `OpenRouter ${resp.status}`,
        resp.status,
        errText.slice(0, 600),
      );
    }
    const json = (await resp.json()) as ChatResponse;
    const images = json.choices?.[0]?.message?.images ?? [];
    for (const img of images) {
      const url = img.image_url?.url;
      if (typeof url === "string" && url.startsWith("data:")) {
        // data:image/png;base64,XXXX
        const m = url.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          const mime = m[1] || "image/png";
          const bytes = Uint8Array.from(Buffer.from(m[2], "base64"));
          return { bytes, mime };
        }
      } else if (typeof url === "string" && url.startsWith("http")) {
        // Some providers return signed URLs — fetch the bytes.
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        return { bytes: new Uint8Array(buf), mime: r.headers.get("content-type") || "image/png" };
      }
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function generatePostImages(
  prompt: string,
  opts: {
    n?: number;
    model?: string;
    timeoutMs?: number;
  } = {},
): Promise<GeneratedVariant[]> {
  const n = Math.max(1, Math.min(4, opts.n ?? 4));
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  // Fire variants in parallel — each is an independent chat-completions
  // call. Failures don't take down siblings; we return whatever lands.
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => callOnce(prompt, model, timeoutMs)),
  );

  const variants: GeneratedVariant[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) variants.push(r.value);
  }
  return variants;
}

export type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  paper: string;
};

// Carousel slides need visual consistency across 6-8 frames →
// editorial illustration baseline. Single-image posts carry the whole
// narrative weight → cinematic scene baseline (more like a film still
// or magazine cover). Operators can override per-account via the
// brand_prompt_prefix setting.
const CAROUSEL_DEFAULT_STYLE_BLOCK = `[STYLE BLOCK]
Editorial illustration in the style of a New Yorker cover or a hand-drawn newsroom diagram. Solid physical objects, real-world metaphors, natural scenes. Hand-drawn line work over flat color blocks. Slight grain texture.`;

const SINGLE_IMAGE_DEFAULT_STYLE_BLOCK = `[STYLE BLOCK]
Cinematic editorial scene with mixed-media composition. Photorealistic product / UI / interface elements where the post topic calls for them, with hand-drawn or illustrated supporting elements. Dramatic lighting, layered detail, real readable text where it serves the metaphor. Magazine-cover or film-still aesthetic — scroll-stopping, narrative-driven.`;

// [PALETTE] block — appended to every prompt regardless of whether the
// operator wrote a custom brand_prompt_prefix. Separates style/medium
// (handled by the prefix) from color compliance (handled here). Image
// models like gpt-image-1 follow hex codes reasonably; flux-1.1-pro
// follows them very well. Models that ignore hex still pick up the
// descriptive role labels ("background," "accent").
function paletteBlock(p: Palette): string {
  return `[PALETTE — use ONLY these colors]
Background / paper:        ${p.paper}
Ink / line work / type:    ${p.ink}
Primary accent (focal):    ${p.primary}
Secondary tone:            ${p.secondary}
Editorial highlight:       ${p.accent}
No other colors. Treat the background and ink as the dominant pair (>80% of canvas). Reserve accents for the single focal element.`;
}

// Two negative profiles — carousel slides keep the strict editorial-
// illustration constraints (consistency across 6-8 slides matters);
// single-image posts get a much looser set since the one image
// carries the narrative.
const CAROUSEL_NEGATIVE_BLOCK = `[ABSOLUTELY DO NOT INCLUDE]
- No text, words, letters, numbers, percentages, captions, labels, logos, or watermarks anywhere in the image.
- No dashboards, monitors, phone screens, laptop screens, UI mockups, app interfaces, or charts with labels baked in.
- No people's faces, headshots, professional portraits, or stock-photo office scenes (laptops on desks, sticky notes, coffee cups).
- No corporate stock photography vibes. No tech product renders.
- No colors outside the palette block above.
If the subject brief implies any of the above, render the underlying physical metaphor instead.`;

const SINGLE_IMAGE_NEGATIVE_BLOCK = `[CONSTRAINTS]
- No people's faces or headshots.
- No generic stock-photo office scenes (a laptop on a desk as the focal subject is forbidden — but a laptop INSIDE a richer scene is fine).
- Do NOT render the LinkedIn post hook, headline, or post copy as image text. Other text (real UI labels, button text, product names, metric values) IS allowed when it serves the metaphor.
- The palette block above is a strong preference — accent colors should come from there. Real-world textures (wood, metal, dust, cobweb, paper, glass) are allowed and encouraged for cinematic depth.`;

// Build the final prompt the image model receives. Brand prefix lives on
// accounts.brand_prompt_prefix (Settings → Accounts → Edit). The slide's
// own image_gen_prompt is the [SUBJECT] block. Palette is loaded from
// accounts.brand_palette and ALWAYS appended so color compliance
// doesn't depend on whether the operator wrote it into the prefix.
//
// `mode` tunes the constraints: "carousel" stays strict editorial
// illustration (visual consistency across 6-8 slides); "single-image"
// allows cinematic scenes with text/UI/dual-state compositions.
export function assembleImagePrompt(
  brandPrefix: string,
  subject: string,
  palette?: Palette,
  options: {
    mode?: "carousel" | "single-image";
    composition?: string;
    mood?: string;
  } = {},
): string {
  const mode = options.mode ?? "carousel";
  const isSingle = mode === "single-image";
  const parts: string[] = [];
  parts.push(
    brandPrefix.trim() ||
      (isSingle ? SINGLE_IMAGE_DEFAULT_STYLE_BLOCK : CAROUSEL_DEFAULT_STYLE_BLOCK),
  );
  parts.push(`[SUBJECT]\n${subject.trim()}`);
  if (options.composition && options.composition.trim()) {
    parts.push(`[COMPOSITION]\n${options.composition.trim()}`);
  } else if (!isSingle) {
    parts.push(
      "[COMPOSITION]\nSingle strong subject, centered. Generous negative space (60% of canvas empty). Square 1:1 aspect ratio. Editorial newsroom aesthetic — illustrated, not photographed.",
    );
  } else {
    parts.push(
      "[COMPOSITION]\nSquare 1:1 aspect ratio. Cinematic, layered, scroll-stopping. Compose for the post's narrative — single dramatic scene or dual-state contrast as the brief specifies.",
    );
  }
  if (options.mood && options.mood.trim()) parts.push(`[MOOD]\n${options.mood.trim()}`);
  if (palette) parts.push(paletteBlock(palette));
  parts.push(isSingle ? SINGLE_IMAGE_NEGATIVE_BLOCK : CAROUSEL_NEGATIVE_BLOCK);
  return parts.join("\n\n");
}
