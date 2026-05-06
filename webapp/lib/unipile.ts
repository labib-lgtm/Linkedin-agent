import "server-only";
import { getSetting } from "@/lib/settings";

// TS port of the Python unipile_client + unipile_get_my_posts. Single
// source of truth for Unipile HTTP — every server route imports from here
// (publish, competitor analyze, future angle-fetch, etc.).

export class UnipileError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "UnipileError";
    this.status = status;
    this.body = body;
  }
}

async function loadCreds() {
  const apiKey = (await getSetting("unipile.api_key"))?.trim() || null;
  const dsnRaw = (await getSetting("unipile.dsn"))?.trim() || null;
  const accountId = (await getSetting("unipile.account_id"))?.trim() || null;
  if (!apiKey || !dsnRaw || !accountId) {
    throw new UnipileError(
      "Unipile credentials missing. Set api_key, dsn, account_id in /settings.",
      400,
      "",
    );
  }
  const dsn = dsnRaw.startsWith("http") ? dsnRaw : `https://${dsnRaw}`;
  return { apiKey, baseUrl: dsn.replace(/\/$/, ""), accountId };
}

async function unipileFetch<T>(
  method: "GET" | "POST",
  path: string,
  opts: { params?: Record<string, string | number | undefined>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { apiKey, baseUrl } = await loadCreds();
  const url = new URL(`${baseUrl}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const causeMsg = err.cause?.code || err.cause?.message;
    const detail = causeMsg ? `${err.message} (${causeMsg})` : err.message;
    throw new UnipileError(
      `Unipile ${method} ${path} network failure: ${detail}`,
      0,
      `tried ${url.toString()}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new UnipileError(
      `Unipile ${method} ${path} returned ${res.status}`,
      res.status,
      text.slice(0, 800),
    );
  }
  return (await res.json().catch(() => ({}))) as T;
}

export type UnipileAccount = {
  id: string;
  provider?: string;
  [key: string]: unknown;
};

export async function getAccount(): Promise<UnipileAccount> {
  const { accountId } = await loadCreds();
  return unipileFetch<UnipileAccount>(
    "GET",
    `/api/v1/accounts/${encodeURIComponent(accountId)}`,
  );
}

// Walk the account payload to find the LinkedIn member identifier (starts
// with ACo). Mirrors find_linkedin_identifier() from the Python tool.
export function findLinkedInIdentifier(account: unknown): string | null {
  const found: string[] = [];
  function walk(node: unknown) {
    if (node && typeof node === "object") {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else {
        for (const [, v] of Object.entries(node as Record<string, unknown>)) {
          if (typeof v === "string" && v.startsWith("ACo") && v.length > 5) {
            found.push(v);
          }
          walk(v);
        }
      }
    }
  }
  walk(account);
  return found[0] ?? null;
}

// Extract the LinkedIn identifier from a profile URL. Handles locale-prefixed
// paths like /uk/in/foo, trailing slashes, and query strings. Returns null
// for anything that isn't a LinkedIn /in/ URL.
export function identifierFromProfileUrl(url: string): string | null {
  const m = /linkedin\.com(?:\/[a-z]{2})?\/in\/([^/?#]+)/i.exec(url.trim());
  return m ? decodeURIComponent(m[1]) : null;
}

export type UnipilePost = {
  id?: string;
  social_id?: string;
  urn?: string;
  post_type?: string;
  type?: string;
  text?: string;
  body?: string;
  commentary?: string;
  date?: string;
  posted_at?: string;
  created_at?: string;
  reaction_counter?: number;
  comment_counter?: number;
  repost_counter?: number;
  impressions_counter?: number;
  [key: string]: unknown;
};

type PostsPage = {
  items?: UnipilePost[];
  data?: UnipilePost[];
  cursor?: string;
  next_cursor?: string;
  paging?: { cursors?: { after?: string } };
};

type UnipileUserProfile = {
  provider_id?: string;
  id?: string;
  public_identifier?: string;
  [key: string]: unknown;
};

// LinkedIn provider IDs all start with "ACo" — Unipile uses these as the
// canonical user key. The vanity slug from a /in/<slug>/ URL is not
// directly accepted by /users/{id}/posts; we have to look the user up
// first to get their provider_id.
function isProviderId(s: string): boolean {
  return s.startsWith("ACo") && s.length > 5;
}

// Resolves a vanity slug (or provider_id) to the canonical provider_id
// Unipile uses for everything else. Pass-through if already a provider_id.
export async function resolveProviderId(handleOrId: string): Promise<{
  providerId: string;
  profile: UnipileUserProfile;
}> {
  const trimmed = handleOrId.trim();
  if (isProviderId(trimmed)) {
    return { providerId: trimmed, profile: { provider_id: trimmed } };
  }
  const { accountId } = await loadCreds();
  const profile = await unipileFetch<UnipileUserProfile>(
    "GET",
    `/api/v1/users/${encodeURIComponent(trimmed)}`,
    { params: { account_id: accountId, linkedin_sections: "*" }, timeoutMs: 5_500 },
  );
  const id =
    (typeof profile.provider_id === "string" && profile.provider_id) ||
    (typeof profile.id === "string" && profile.id.startsWith("ACo") ? profile.id : null) ||
    findLinkedInIdentifier(profile);
  if (!id) {
    throw new UnipileError(
      `Could not resolve provider_id for "${trimmed}"`,
      502,
      JSON.stringify(profile).slice(0, 400),
    );
  }
  return { providerId: id, profile };
}

// Paginated post fetch. Resolves vanity slugs to provider_id automatically
// when no providerId is supplied; on Hobby plans the analyze route should
// cache the resolved id on the competitor row and pass it via opts so the
// 5s lookup doesn't run on every click.
export async function fetchUserPosts(
  handleOrId: string,
  opts: { maxPosts?: number; pageSize?: number; providerId?: string } = {},
): Promise<{ posts: UnipilePost[]; providerId: string }> {
  const { accountId } = await loadCreds();
  const providerId =
    opts.providerId && isProviderId(opts.providerId)
      ? opts.providerId
      : (await resolveProviderId(handleOrId)).providerId;
  const maxPosts = opts.maxPosts ?? 200;
  const pageSize = opts.pageSize ?? 50;

  const out: UnipilePost[] = [];
  let cursor: string | undefined;
  let safety = 20;
  while (out.length < maxPosts && safety-- > 0) {
    const params: Record<string, string | number | undefined> = {
      account_id: accountId,
      limit: pageSize,
    };
    if (cursor) params.cursor = cursor;
    const resp = await unipileFetch<PostsPage>(
      "GET",
      `/api/v1/users/${encodeURIComponent(providerId)}/posts`,
      { params, timeoutMs: 3_000 },
    );
    const items = resp.items ?? resp.data ?? [];
    out.push(...items);
    cursor = resp.cursor ?? resp.next_cursor ?? resp.paging?.cursors?.after;
    if (!cursor || items.length === 0) break;
  }
  return { posts: out.slice(0, maxPosts), providerId };
}

// Normalise post fields → the shape `competitor_posts` row expects.
// engagement_score is computed by the DB (generated column); we only
// expose a sortable score here for in-memory ordering.
export type NormalizedPost = {
  post_id: string;
  posted_at: string | null;
  text: string | null;
  reactions: number;
  comments: number;
  reposts: number;
  raw: UnipilePost;
};

export function normalizePost(p: UnipilePost): NormalizedPost {
  const post_id =
    String(p.social_id ?? p.urn ?? p.id ?? "").trim() ||
    `unknown-${Math.random().toString(36).slice(2, 10)}`;
  const postedRaw = p.date ?? p.posted_at ?? p.created_at ?? null;
  const posted_at = postedRaw ? new Date(postedRaw).toISOString() : null;
  const text = (p.text ?? p.body ?? p.commentary ?? null) as string | null;
  return {
    post_id,
    posted_at,
    text,
    reactions: Number(p.reaction_counter ?? 0) || 0,
    comments: Number(p.comment_counter ?? 0) || 0,
    reposts: Number(p.repost_counter ?? 0) || 0,
    raw: p,
  };
}

// In-memory score for sorting. Same formula as the DB generated column so
// pre-insert sorts agree with post-insert query orders.
export function scorePost(p: NormalizedPost): number {
  return p.reactions + p.comments * 3 + p.reposts * 5;
}

// Publish a text post. Used by the publish route — keeps Unipile API
// surface in one place.
export async function publishTextPost(text: string): Promise<{
  postId: string;
  postUrl: string;
  raw: Record<string, unknown>;
}> {
  const { accountId } = await loadCreds();
  const payload = await unipileFetch<Record<string, unknown>>("POST", "/api/v1/posts", {
    body: { account_id: accountId, text },
  });
  const postId =
    (payload.post_id as string | undefined) ??
    (payload.id as string | undefined) ??
    (payload.social_id as string | undefined) ??
    (payload.urn as string | undefined);
  if (!postId) {
    throw new UnipileError(
      "Unipile response missing post_id",
      502,
      JSON.stringify(payload).slice(0, 800),
    );
  }
  const postUrl =
    (payload.share_url as string | undefined) ??
    (payload.url as string | undefined) ??
    (payload.post_url as string | undefined) ??
    (payload.public_url as string | undefined) ??
    `https://www.linkedin.com/feed/update/${postId}/`;
  return { postId, postUrl, raw: payload };
}
