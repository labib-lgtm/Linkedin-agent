import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { runDigest, DigestError } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

async function handle() {
  try {
    const digest = await runDigest();
    return NextResponse.json({ ok: true, week_start: digest?.week_start });
  } catch (e) {
    if (e instanceof DigestError) {
      // 'no_posts_in_window' is expected on quiet weeks — return 200 so
      // Vercel's cron retry logic doesn't keep firing.
      const status = e.code === "no_posts_in_window" ? 200 : e.status;
      return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status });
    }
    return NextResponse.json(
      { ok: false, message: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return handle();
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return handle();
}
