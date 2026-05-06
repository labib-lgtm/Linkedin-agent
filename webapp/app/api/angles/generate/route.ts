import { NextResponse, type NextRequest } from "next/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { PILLAR_VALUES, FORMAT_VALUES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  topic?: string;
  pillar?: string;
  format?: string;
  count?: number;
};

const SYSTEM_PROMPT = `You are an angle generator for Lynx Media's LinkedIn presence (Amazon PPC agency, $29M+ managed for sellers and brands). The audience is operators — Amazon brand owners, agency founders, in-house PPC managers — not students.

Output strict JSON in this shape:
{
  "angles": [
    {
      "hook_seed": "Specific opener (1 sentence). Must be operator-grade — concrete numbers, named tactics, no fluff. NEVER use em-dashes, asterisks (* or **), or hash characters.",
      "cta_keyword": "ONE WORD in caps, the keyword commenters reply with to get the lead magnet (e.g. AUDIT, TEMPLATE, BIDS, SOP).",
      "gap_filled": "One sentence: what knowledge gap this angle fills for the operator audience."
    }
  ]
}

Style rules:
- Lynx Media voice: contrarian, specifics over platitudes, operator-grade language.
- Hook seeds must be SPECIFIC (numbers, named tactics, named tools). Reject generic LinkedIn-bait.
- No em-dashes, asterisks, or hash characters in any string output.
- cta_keyword must be a single ALL-CAPS word relevant to what they'd download.
- Each angle should be distinct in framing — don't generate three rephrasings of the same insight.`;

function buildUserPrompt(topic: string, pillar: string, fmt: string, count: number): string {
  return [
    `Topic: ${topic}`,
    `Pillar: ${pillar}`,
    `Format: ${fmt}`,
    `Count: ${count}`,
    "",
    `Generate ${count} distinct angles on this topic, sliced for the ${pillar} pillar and the ${fmt} format. Return ONLY the JSON object, no prose.`,
  ].join("\n");
}

type Generated = {
  angles?: Array<{ hook_seed?: string; cta_keyword?: string; gap_filled?: string }>;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const topic = String(body.topic ?? "").trim();
  const pillar = String(body.pillar ?? "");
  const fmt = String(body.format ?? "text");
  const count = Math.max(1, Math.min(8, Number(body.count ?? 3)));

  if (!topic) return NextResponse.json({ error: "topic_required" }, { status: 400 });
  if (!(PILLAR_VALUES as readonly string[]).includes(pillar)) {
    return NextResponse.json({ error: "invalid_pillar" }, { status: 400 });
  }
  if (!(FORMAT_VALUES as readonly string[]).includes(fmt)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }

  try {
    const result = await generateJson<Generated>({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(topic, pillar, fmt, count),
      temperature: 0.8,
      maxTokens: 1200,
    });
    const drafts = (result.angles ?? [])
      .filter((a) => a && typeof a.hook_seed === "string")
      .slice(0, count)
      .map((a) => ({
        hook_seed: String(a.hook_seed ?? "").trim(),
        cta_keyword: String(a.cta_keyword ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24),
        gap_filled: String(a.gap_filled ?? "").trim(),
      }));
    if (drafts.length === 0) {
      return NextResponse.json(
        { error: "no_angles_generated", message: "Model returned no usable drafts" },
        { status: 502 },
      );
    }
    return NextResponse.json({ drafts, topic, pillar, format: fmt });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "generate_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
