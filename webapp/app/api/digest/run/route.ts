import { NextResponse, type NextRequest } from "next/server";
import { runDigest, DigestError } from "@/lib/digest";
import { OpenRouterError } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  let body: { week_start?: string } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  try {
    const digest = await runDigest(body.week_start);
    return NextResponse.json({ digest });
  } catch (e) {
    if (e instanceof DigestError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    if (e instanceof OpenRouterError) {
      return NextResponse.json({ error: "openrouter_failed", body: e.body }, { status: 502 });
    }
    return NextResponse.json(
      { error: "digest_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
