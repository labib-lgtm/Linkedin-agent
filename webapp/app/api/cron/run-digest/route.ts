import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { runDigest, DigestError } from "@/lib/digest";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Run digest for every non-archived account in a single cron tick. With
// ~3-5 accounts each digest runs ~3-5s; the 10s ceiling holds because
// each account's runDigest is sequential but each step is fast (Hobby
// limits don't apply per-account, just per-invocation, so we have to
// fit everything in 10s — fine for now, will need Trigger.dev once Lynx
// has 10+ accounts).
async function handle() {
  const supabase = createServiceClient();
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const results: Array<{ account_id: string; name: string; ok: boolean; week_start?: string; error?: string }> = [];
  for (const a of accounts ?? []) {
    try {
      const digest = await runDigest(a.id);
      results.push({ account_id: a.id, name: a.name, ok: true, week_start: digest.week_start });
    } catch (e) {
      if (e instanceof DigestError && e.code === "no_posts_in_window") {
        // Quiet week for this account — log and continue, not a failure.
        results.push({ account_id: a.id, name: a.name, ok: true, error: "no_posts" });
        continue;
      }
      results.push({
        account_id: a.id,
        name: a.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, results });
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
