/**
 * Unipile HTTP wrapper for Trigger.dev tasks.
 *
 * Mirrors tools/unipile_client.py — same DSN base URL, same X-API-KEY header,
 * same retry behavior on 429/5xx. Reads creds from env vars set in the
 * Trigger.dev project's environment (NOT the local .env):
 *   UNIPILE_API_KEY
 *   UNIPILE_DSN
 *   UNIPILE_LINKEDIN_ACCOUNT_ID
 */

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function env(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing env var: ${key}. Set it in the Trigger.dev project's Environment Variables.`,
    );
  }
  return v;
}

function baseUrl(): string {
  return `https://${env("UNIPILE_DSN")}`;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retries = 3,
): Promise<T> {
  const url = baseUrl().replace(/\/$/, "") + path;
  const headers: Record<string, string> = {
    "X-API-KEY": env("UNIPILE_API_KEY"),
    accept: "application/json",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (resp.ok) {
        const text = await resp.text();
        return text ? (JSON.parse(text) as T) : ({} as T);
      }
      if (TRANSIENT_STATUSES.has(resp.status) && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      const errBody = await resp.text();
      throw new Error(`Unipile ${method} ${path} -> ${resp.status}: ${errBody}`);
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Unipile request failed after retries: ${String(lastErr)}`);
}

/** Post a comment in reply to (or on) an existing post comment thread. */
export async function postComment(args: {
  postId: string;
  text: string;
}): Promise<{ id?: string }> {
  return request("POST", `/api/v1/posts/${args.postId}/comments`, {
    account_id: env("UNIPILE_LINKEDIN_ACCOUNT_ID"),
    text: args.text,
  });
}

/** Send a 1:1 DM. The exact endpoint name varies by Unipile version; this
 *  matches the documented "start chat" / "send message" pattern.
 *  If your Unipile DSN uses a different path, adjust here. */
export async function sendDm(args: {
  recipientId: string;
  text: string;
}): Promise<{ id?: string; chat_id?: string }> {
  return request("POST", `/api/v1/chats`, {
    account_id: env("UNIPILE_LINKEDIN_ACCOUNT_ID"),
    attendees_ids: [args.recipientId],
    text: args.text,
  });
}
