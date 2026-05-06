import "server-only";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

export const ACTIVE_ACCOUNT_COOKIE = "lynx_active_account";

// Server-only helper. Reads the active account id from a non-signed cookie
// (lynx_active_account) that the AccountSwitcher writes. We don't sign it
// because:
//   - It's just UI state, not auth — the signed lynx_session cookie still
//     gates everything.
//   - There's one operator (Lynx Media internal tool, not a SaaS), so
//     "tampering" to switch contexts is the same as clicking the picker.
//
// Falls back to the oldest non-archived account when the cookie is missing
// or refers to an archived/deleted id.
export async function getActiveAccountId(): Promise<string> {
  const store = await cookies();
  const cookieVal = store.get(ACTIVE_ACCOUNT_COOKIE)?.value;
  const supabase = createServiceClient();

  if (cookieVal) {
    const { data } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", cookieVal)
      .is("archived_at", null)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // Fallback: oldest non-archived account. Migration 006 ensures at least
  // one ("Lynx Media") exists.
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      "No active accounts. Apply migration 006 to seed the default Lynx Media account.",
    );
  }
  return data.id;
}

// Same logic but accepts a raw cookie store (for routes that already
// extracted the cookie via NextRequest, avoiding double-reads).
export async function resolveActiveAccountId(
  cookieValue: string | undefined,
): Promise<string> {
  const supabase = createServiceClient();
  if (cookieValue) {
    const { data } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", cookieValue)
      .is("archived_at", null)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (!data) {
    throw new Error("No active accounts");
  }
  return data.id;
}
