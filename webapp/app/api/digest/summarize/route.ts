import { NextResponse, type NextRequest } from "next/server";
import { summarizeDigest, DigestError, type DigestReadOut } from "@/lib/digest";
import { OpenRouterError } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Phase 2: takes the read payload from /run and runs the LLM. Isolated
// from the reads so the model call gets its own dedicated budget.
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[digest/summarize] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest) {
  let body: { read?: DigestReadOut };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const read = body.read;
  if (!read || !read.week_start || !read.llm_input || !Array.isArray(read.top_posts)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const summary = await summarizeDigest(read);
    return NextResponse.json({ summary });
  } catch (e) {
    if (e instanceof DigestError) {
      console.error("[digest/summarize] DigestError", e.code, e.message);
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    if (e instanceof OpenRouterError) {
      console.error("[digest/summarize] OpenRouterError", e.status, e.message, e.body);
      return NextResponse.json(
        {
          error: "openrouter_failed",
          status: e.status,
          message: e.message,
          body: e.body,
        },
        { status: 502 },
      );
    }
    console.error("[digest/summarize] unhandled", e);
    return NextResponse.json(
      { error: "summarize_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
