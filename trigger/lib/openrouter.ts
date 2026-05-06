/**
 * OpenRouter wrapper for Trigger.dev tasks (Phase 4 hook extraction +
 * embedding). Mirrors webapp/lib/openrouter.ts but trimmed to the two
 * call types the worker needs: JSON generation and embedding.
 *
 * Required env vars (set in Trigger.dev project):
 *   OPENROUTER_API_KEY
 */

const ENDPOINT_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const ENDPOINT_EMBED = "https://openrouter.ai/api/v1/embeddings";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export async function generateJson<T>(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const model = opts.model ?? "anthropic/claude-3.5-haiku";
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lynxmedia.co",
        "X-Title": "LinkedIn Agent (worker)",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              opts.system +
              "\n\nCRITICAL: Output ONLY a single valid JSON object. No prose, no markdown.",
          },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 600,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 300)}`);
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (json.error) throw new Error(`OpenRouter error: ${json.error.message}`);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter missing content");
    // Strip markdown fences and find outermost {...}.
    const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const start = trimmed.search(/[{[]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    return JSON.parse(candidate) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateEmbedding(
  text: string,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<number[]> {
  const model = opts.model ?? "openai/text-embedding-3-small";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT_EMBED, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lynxmedia.co",
        "X-Title": "LinkedIn Agent (worker)",
      },
      body: JSON.stringify({ model, input: text.slice(0, 4000) }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Embedding ${res.status}: ${raw.slice(0, 300)}`);
    const json = JSON.parse(raw) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) throw new Error("Embedding missing");
    return vec;
  } finally {
    clearTimeout(timer);
  }
}

// Cosine similarity between two equal-length vectors.
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Element-wise mean of an array of vectors. Used to compute the centroid
// of a cluster after each batch of new posts joins it.
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}
