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

/** Comment on a published post. Mirrors the loose shape returned by Unipile —
 *  the Python monitor probes the same endpoints, so we match its tolerance
 *  by accepting items / data / comments under different keys. */
export interface UnipileComment {
  id?: string;
  comment_id?: string;
  social_id?: string;
  urn?: string;
  text?: string;
  body?: string;
  commentary?: string;
  commenter?: { id?: string; provider_id?: string; public_identifier?: string; name?: string; full_name?: string; display_name?: string };
  author?: { id?: string; provider_id?: string; public_identifier?: string; name?: string; full_name?: string; display_name?: string };
  user?: { id?: string; provider_id?: string; public_identifier?: string; name?: string; full_name?: string; display_name?: string };
  commenter_id?: string;
  author_id?: string;
}

interface CommentListResponse {
  items?: UnipileComment[];
  data?: UnipileComment[];
  comments?: UnipileComment[];
  paging?: unknown;
  cursor?: unknown;
}

/** Fetch comments on a post. Unipile is finicky about the post identifier
 *  shape — sometimes it accepts the bare numeric activity id, sometimes
 *  it demands a full URN. We try the most-likely forms in sequence and
 *  return on the first success.
 *
 *  Unipile GET endpoints also require account_id as a query param (POSTs
 *  accept it in the body). All URLs below include it. */
export async function fetchPostComments(postId: string): Promise<UnipileComment[]> {
  const accountId = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));

  // Build the candidate id list. If the caller already passed a URN we
  // try that first and bail out if Unipile rejects it. If the caller
  // passed a bare numeric, we try each URN type in turn — `activity` is
  // the most common shape for `/feed/update/N/` URLs but Unipile DSNs
  // disagree on which they accept.
  const isUrn = /^urn:li:[a-zA-Z]+:\d+$/.test(postId);
  const numericMatch = postId.match(/^\d+$/);
  const candidates = isUrn
    ? [postId]
    : numericMatch
      ? [
          `urn:li:activity:${postId}`,
          `urn:li:share:${postId}`,
          `urn:li:ugcPost:${postId}`,
          postId, // last-resort: bare numeric (some DSNs accept it)
        ]
      : [postId];

  let lastErr: unknown = null;
  for (const candidate of candidates) {
    const encoded = encodeURIComponent(candidate);
    try {
      const r = await request<CommentListResponse>(
        "GET",
        `/api/v1/posts/${encoded}/comments?account_id=${accountId}`,
      );
      return r.items ?? r.data ?? r.comments ?? [];
    } catch (e) {
      lastErr = e;
      // Treat 400 "invalid post_id" as a signal to try the next URN form.
      // Anything else (auth, 5xx) is fatal — don't keep guessing.
      const msg = String(e);
      const isInvalidId = /400/.test(msg) && /invalid post_id|errors\/malformed_request|errors\/invalid_parameters/.test(msg);
      if (!isInvalidId) break;
    }
  }

  // Final fallback — flat endpoint with post_id as query param. Use the
  // original input verbatim here since this endpoint shape may have its
  // own preferred id form.
  try {
    const r = await request<CommentListResponse>(
      "GET",
      `/api/v1/comments?post_id=${encodeURIComponent(postId)}&account_id=${accountId}`,
    );
    return r.items ?? r.data ?? r.comments ?? [];
  } catch {
    throw lastErr ?? new Error("fetchPostComments: all candidates failed");
  }
}

/** Best-effort comment id extractor — Unipile shape varies. */
export function commentId(c: UnipileComment): string {
  return String(c.id ?? c.comment_id ?? c.social_id ?? c.urn ?? "");
}

/** Best-effort comment body extractor. */
export function commentText(c: UnipileComment): string {
  return String(c.text ?? c.body ?? c.commentary ?? "");
}

/** Best-effort commenter id (used as DM recipient_id). */
export function commenterId(c: UnipileComment): string {
  for (const node of [c.commenter, c.author, c.user]) {
    if (node) {
      const id = node.id ?? node.provider_id ?? node.public_identifier;
      if (id) return String(id);
    }
  }
  return String(c.commenter_id ?? c.author_id ?? "");
}

/** Best-effort commenter display name. */
export function commenterName(c: UnipileComment): string {
  for (const node of [c.commenter, c.author, c.user]) {
    if (node) {
      const name = node.name ?? node.full_name ?? node.display_name;
      if (name) return String(name);
    }
  }
  return "";
}
