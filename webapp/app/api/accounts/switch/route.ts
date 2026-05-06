import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ACTIVE_ACCOUNT_COOKIE } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// POST /api/accounts/switch — set the lynx_active_account cookie.
// Validates that the target account exists + is non-archived before
// writing the cookie so getActiveAccountId never has to clean up junk.
export async function POST(req: NextRequest) {
  let body: { accountId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId_required" }, { status: 400 });
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }
  const res = NextResponse.json({ account: data });
  res.cookies.set(ACTIVE_ACCOUNT_COOKIE, accountId, {
    path: "/",
    httpOnly: false,            // not auth, just UI state — readable by client if useful
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  return res;
}
