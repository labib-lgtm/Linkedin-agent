import "server-only";
import { getSetting } from "@/lib/settings";

export class OpenRouterError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.body = body;
  }
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Message = { role: "system" | "user" | "assistant"; content: string };

async function callOpenRouter(opts: {
  messages: Message[];
  model?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = await getSetting("openrouter.api_key");
  if (!apiKey) {
    throw new OpenRouterError(
      "OpenRouter API key missing. Set openrouter.api_key in /settings.",
      400,
      "",
    );
  }
  const model =
    opts.model ?? (await getSetting("openrouter.text_model")) ?? "anthropic/claude-3.5-sonnet";

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1500,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://lynxmedia.co",
      "X-Title": "LinkedIn Agent",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OpenRouterError(
      `OpenRouter ${res.status}`,
      res.status,
      text.slice(0, 800),
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new OpenRouterError("OpenRouter response missing content", 502, JSON.stringify(json).slice(0, 800));
  }
  return content;
}

// Strip ``` fences if the model wrapped JSON in markdown.
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// Generate JSON. One retry with the malformed body fed back to the model.
export async function generateJson<T>(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  const first = await callOpenRouter({
    messages,
    model: opts.model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    jsonMode: true,
  });

  try {
    return JSON.parse(stripFences(first)) as T;
  } catch {
    // re-prompt with the malformed body so the model can self-correct
    const retryMessages: Message[] = [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Reply again with ONLY valid JSON, no prose, no code fences.",
      },
    ];
    const second = await callOpenRouter({
      messages: retryMessages,
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: true,
    });
    return JSON.parse(stripFences(second)) as T;
  }
}

export async function generateText(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  return callOpenRouter({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    model: opts.model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });
}
