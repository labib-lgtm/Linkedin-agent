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

/** Fetch comments on a post. The exact endpoint shape varies by Unipile
 *  DSN version; we try the /posts/:id/comments form first, then the flat
 *  /comments?post_id= fallback (mirrors tools/unipile_monitor_comments.py
 *  _fetch_comments at lines 94–119). */
export async function fetchPostComments(postId: string): Promise<UnipileComment[]> {
  const primary = `/api/v1/posts/${encodeURIComponent(postId)}/comments`;
  try {
    const r = await request<CommentListResponse>("GET", primary);
    return r.items ?? r.data ?? r.comments ?? [];
  } catch (e) {
    // Fall back to the flat endpoint with post_id query.
    try {
      const fallback = `/api/v1/comments?post_id=${encodeURIComponent(postId)}`;
      const r = await request<CommentListResponse>("GET", fallback);
      return r.items ?? r.data ?? r.comments ?? [];
    } catch {
      throw e;
    }
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
