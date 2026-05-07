/**
 * OpenAI gpt-image-1 wrapper for the Trigger.dev image-generation task.
 *
 * Uses the REST API directly (no SDK) for the same reasons the OpenRouter
 * lib does: keeps the bundle lean and the call shape transparent. Returns
 * 4 variants per call; the slide editor's variant grid lets the user pick
 * one and discards the others (Phase C ships everything in Storage; the
 * "killed-angle cleanup" phase lands later).
 *
 * Quality / cost (2026 pricing):
 *   low      → ~$0.011 / image · 1024x1024
 *   medium   → ~$0.042 / image · 1024x1024
 *   high     → ~$0.167 / image · 1024x1024
 *
 * We default to medium — gives clean enough output for editorial
 * carousels at ~$0.17 per slide (4 variants) which is the budget the
 * roast called out.
 */

const ENDPOINT = "https://api.openai.com/v1/images/generations";

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

export async function generatePostImages(
  prompt: string,
  opts: {
    n?: number;
    size?: "1024x1024" | "1024x1536" | "1536x1024";
    quality?: "low" | "medium" | "high";
    timeoutMs?: number;
  } = {},
): Promise<GeneratedVariant[]> {
  const apiKey = env("OPENAI_API_KEY");
  const n = Math.max(1, Math.min(4, opts.n ?? 4));

  const body = {
    model: "gpt-image-1",
    prompt,
    n,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "medium",
  };

  const timeoutMs = opts.timeoutMs ?? 120_000; // 2 min per call — variants serialize internally
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  abortTimer.unref?.();

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new ImageGenError(
        `gpt-image-1 ${resp.status}`,
        resp.status,
        errText.slice(0, 600),
      );
    }

    const json = (await resp.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const data = json.data ?? [];

    const variants: GeneratedVariant[] = [];
    for (const item of data) {
      if (item.b64_json) {
        // Base64 → bytes
        const bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"));
        variants.push({ bytes, mime: "image/png" });
      } else if (item.url) {
        // URL fallback (older response shape) — fetch the bytes.
        const r = await fetch(item.url);
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get("content-type") || "image/png";
        variants.push({ bytes: new Uint8Array(buf), mime });
      }
    }
    return variants;
  } finally {
    clearTimeout(abortTimer);
  }
}

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
  if (brandPrefix.trim()) parts.push(brandPrefix.trim());
  parts.push(`[SUBJECT]\n${subject.trim()}`);
  if (composition && composition.trim()) {
    parts.push(`[COMPOSITION]\n${composition.trim()}`);
  } else {
    parts.push(
      "[COMPOSITION]\nCentered subject. Generous negative space. 1.6:1 visual hierarchy. Editorial newsroom aesthetic.",
    );
  }
  if (mood && mood.trim()) parts.push(`[MOOD]\n${mood.trim()}`);
  return parts.join("\n\n");
}
