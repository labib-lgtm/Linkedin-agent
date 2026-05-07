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

// Built-in baseline style fired when an account has no
// brand_prompt_prefix set. Without it the image model defaults to
// stock-photo / dashboard-y output. Operators override per-account
// via Settings → Accounts → Edit.
const DEFAULT_STYLE_BLOCK = `[STYLE BLOCK]
Editorial illustration in the style of a New Yorker cover or a hand-drawn newsroom diagram. Solid physical objects, real-world metaphors, natural scenes. Hand-drawn line work over flat color blocks. Slight grain texture. Limited palette: cream paper, ink, one rust accent, one olive accent.`;

// [NEGATIVE] block — repeats the constraints from the drafter prompt
// directly to the image model, since some image models (gpt-image-1,
// gemini-flash-image) over-index on the most concrete-sounding noun
// in the prompt (e.g. "dashboard") even when the system prompt
// forbids it. Putting the prohibitions inside the literal image
// prompt shifts attention.
const NEGATIVE_BLOCK = `[ABSOLUTELY DO NOT INCLUDE]
- No text, words, letters, numbers, percentages, captions, labels, logos, or watermarks anywhere in the image.
- No dashboards, monitors, phone screens, laptop screens, UI mockups, app interfaces, or charts with labels baked in.
- No people's faces, headshots, professional portraits, or stock-photo office scenes (laptops on desks, sticky notes, coffee cups).
- No magnifying glasses on listings, no rising-arrow charts, no bar/line graphs unless hand-drawn on paper.
- No corporate stock photography vibes. No tech product renders.
If the subject brief implies any of the above, render the underlying physical metaphor instead (a leaking bucket, a maze, a tangled knot, a tightrope, gears, dominoes, an unlocked door).`;

// Build the final prompt the image model receives. Brand prefix lives on
// accounts.brand_prompt_prefix (Settings → Accounts → Edit). The slide's
// own image_gen_prompt is the [SUBJECT] block.
export function assembleImagePrompt(
  brandPrefix: string,
  subject: string,
  composition?: string,
  mood?: string,
): string {
  const parts: string[] = [];
  parts.push(brandPrefix.trim() || DEFAULT_STYLE_BLOCK);
  parts.push(`[SUBJECT]\n${subject.trim()}`);
  if (composition && composition.trim()) {
    parts.push(`[COMPOSITION]\n${composition.trim()}`);
  } else {
    parts.push(
      "[COMPOSITION]\nSingle strong subject, centered. Generous negative space (60% of canvas empty). Square 1:1 aspect ratio. Editorial newsroom aesthetic — illustrated, not photographed.",
    );
  }
  if (mood && mood.trim()) parts.push(`[MOOD]\n${mood.trim()}`);
  parts.push(NEGATIVE_BLOCK);
  return parts.join("\n\n");
}
