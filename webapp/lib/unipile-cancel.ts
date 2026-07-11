import "server-only";
import { getSetting } from "@/lib/settings";

// Webapp-side helper for cancelling a LinkedIn invitation via Unipile.
// Mirrors trigger/lib/unipile.ts:cancelInvitation but reuses the webapp's
// credentials loader instead of process.env — the webapp settings table
// is the source of truth for the DSN + API key.

interface Creds {
  apiKey: string;
  baseUrl: string;
  accountId: string;
}

async function loadCreds(): Promise<Creds> {
  const apiKey = (await getSetting("unipile.api_key"))?.trim() || null;
  const dsnRaw = (await getSetting("unipile.dsn"))?.trim() || null;
  const accountId = (await getSetting("unipile.account_id"))?.trim() || null;
  if (!apiKey || !dsnRaw || !accountId) {
    throw new Error("Unipile credentials missing in settings");
  }
  const dsn = dsnRaw.startsWith("http") ? dsnRaw : `https://${dsnRaw}`;
  return { apiKey, baseUrl: dsn.replace(/\/$/, ""), accountId };
}

async function unipile(method: "DELETE" | "POST", path: string, body?: unknown): Promise<Response> {
  const { apiKey, baseUrl } = await loadCreds();
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "X-API-KEY": apiKey,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function cancelUnipileInvitation(providerId: string): Promise<void> {
  const trimmed = (providerId ?? "").trim();
  if (!trimmed) throw new Error("providerId required");
  const { accountId } = await loadCreds();

  // Primary: DELETE /api/v1/users/invite/{provider_id}?account_id=...
  const primary = await unipile(
    "DELETE",
    `/api/v1/users/invite/${encodeURIComponent(trimmed)}?account_id=${encodeURIComponent(accountId)}`,
  );
  if (primary.ok) return;

  // Fall back to body-shaped form if DSN rejects path form
  if (primary.status === 404 || primary.status === 405) {
    const fb = await unipile("POST", `/api/v1/users/invite/cancel`, {
      provider_id: trimmed,
      account_id: accountId,
    });
    if (fb.ok) return;
    const errBody = await fb.text().catch(() => "");
    throw new Error(`cancel fallback -> ${fb.status}: ${errBody.slice(0, 400)}`);
  }

  const errBody = await primary.text().catch(() => "");
  throw new Error(`cancel -> ${primary.status}: ${errBody.slice(0, 400)}`);
}
