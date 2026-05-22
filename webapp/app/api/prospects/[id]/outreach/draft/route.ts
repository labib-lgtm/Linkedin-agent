import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { getBusinessProfile } from "@/lib/business";
import { getVoiceSamples } from "@/lib/voice";
import { generateJson, OpenRouterError } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/prospects/[id]/outreach/draft  body: { kind: "invite" | "dm" }
//
// Drafts a connection note or a DM for an enrolled prospect, grounded in
// the business profile + voice. Saves it to prospect_outreach
// (invite_message / dm_text) and returns the text for the operator to
// edit + approve. Hybrid model: nothing sends until approved.

function sanitize(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/\*/g, "")
    .replace(/#/g, "")
    .trim();
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: { kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const kind = body.kind;
  if (kind !== "invite" && kind !== "dm") {
    return NextResponse.json({ error: "kind_must_be_invite_or_dm" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { data: prospect, error: pErr } = await supabase
    .from("prospects")
    .select("id, name, headline, seller:sellers(seller_name, brand_name, business_name, category)")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!prospect) return NextResponse.json({ error: "prospect_not_found" }, { status: 404 });

  const sellerRel = prospect.seller as
    | { seller_name: string | null; brand_name: string | null; business_name: string | null; category: string | null }
    | { seller_name: string | null; brand_name: string | null; business_name: string | null; category: string | null }[]
    | null;
  const seller = Array.isArray(sellerRel) ? (sellerRel[0] ?? null) : sellerRel;
  const brand =
    seller?.brand_name || seller?.seller_name || seller?.business_name || "their brand";
  const firstName = (prospect.name ?? "").trim().split(/\s+/)[0] || "there";

  const [business, samples] = await Promise.all([
    getBusinessProfile(),
    getVoiceSamples(accountId, 3),
  ]);
  const samplesBlock =
    samples.length > 0
      ? samples.map((s, i) => `[Sample ${i + 1}]\n${s.slice(0, 500)}`).join("\n\n")
      : "(No prior posts. Match the voice description.)";

  const common = `You write on behalf of ${business.name}.
Business: ${business.description}
Audience: ${business.audience}
Voice: ${business.voice}

Voice samples:
${samplesBlock}

Prospect: ${prospect.name ?? "(unknown)"} — ${prospect.headline ?? "(no headline)"}
Their Amazon brand: ${brand}${seller?.category ? ` (${seller.category})` : ""}

Hard rules: no em-dashes, no asterisks, no hash characters, no generic LinkedIn voice, no "I hope this finds you well". Sound human and specific.`;

  const system =
    kind === "invite"
      ? `${common}

Write a LinkedIn CONNECTION REQUEST NOTE. Constraints:
- Max 200 characters (LinkedIn limit). Keep it short.
- Warm, peer-to-peer, NOT a pitch. Reference their brand or what they do.
- No ask, no link, no selling. Just a genuine reason to connect.
- Address them by first name (${firstName}).

Output strict JSON: { "text": "the note, <= 200 chars" }`
      : `${common}

Write a first DIRECT MESSAGE to send after they accept the connection. Constraints:
- 2-4 short sentences, <= 500 characters.
- Lead with something specific to their brand / Amazon situation, not about us.
- Soft, low-pressure. End with a light question or offer, not a hard sell.
- Address them by first name (${firstName}).

Output strict JSON: { "text": "the DM, <= 500 chars" }`;

  let text: string;
  try {
    const res = await generateJson<{ text?: string }>({
      system,
      user:
        kind === "invite"
          ? "Write the connection note now."
          : "Write the first DM now.",
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.6,
      maxTokens: 300,
      timeoutMs: 20_000,
      retryFastFailures: true,
    });
    text = sanitize((res.text ?? "").trim());
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "draft_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
  if (!text) return NextResponse.json({ error: "empty_draft" }, { status: 502 });

  const column = kind === "invite" ? "invite_message" : "dm_text";
  const { error: upErr } = await supabase
    .from("prospect_outreach")
    .update({ [column]: text })
    .eq("prospect_id", id)
    .eq("account_id", accountId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ text, kind });
}
