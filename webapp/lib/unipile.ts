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
  // Manual timer + AbortController. AbortSignal.timeout() schedules a Node
  // timer that's NOT auto-unref'd, so when fetch completes early the
  // pending timer keeps the lambda alive until either it fires or
  // maxDuration kicks in. Burned the entire 10s budget on a 1.2s call.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  abortTimer.unref?.();

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
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(abortTimer);
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const causeMsg = err.cause?.code || err.cause?.message;
    const detail = causeMsg ? `${err.message} (${causeMsg})` : err.message;
    throw new UnipileError(
      `Unipile ${method} ${path} network failure: ${detail}`,
      0,
      `tried ${url.toString()}`,
    );
  }
  clearTimeout(abortTimer);
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

// Extract the LinkedIn identifier from a profile URL. Handles:
// - www.linkedin.com/in/handle
// - linkedin.com/in/handle           (no www)
// - uk.linkedin.com/in/handle        (country subdomain)
// - linkedin.com/uk/in/handle        (locale path prefix)
// - linkedin.com/en-us/in/handle     (multi-char locale)
// - trailing slashes, query strings, fragments
// - URLs without a scheme (linkedin.com/in/handle)
// - bare handles (just "elizabeth-greene-junglr")
// Returns null only when truly nothing handle-like is present.
export function identifierFromProfileUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // 1. Standard /in/<handle> match — case-insensitive, optional locale.
  const m = /linkedin\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?in\/([^/?#\s]+)/i.exec(trimmed);
  if (m) return decodeURIComponent(m[1]);

  // 2. Already a bare handle — no slashes, no spaces, looks slug-y.
  if (/^[a-z0-9][a-z0-9_-]{2,}$/i.test(trimmed)) return trimmed;

  // 3. Already an ACo... provider id. Unipile accepts these directly.
  if (/^ACo[A-Za-z0-9_-]{4,}$/.test(trimmed)) return trimmed;

  return null;
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
export type MediaItem = {
  url: string;
  type: "image" | "video" | "document" | "article" | "gif";
  thumbnail_url?: string;
  title?: string;
};

export type MediaType = MediaItem["type"] | "none";

export type NormalizedPost = {
  post_id: string;
  posted_at: string | null;
  text: string | null;
  reactions: number;
  comments: number;
  reposts: number;
  impressions: number | null;
  media_urls: MediaItem[];
  media_type: MediaType;
  raw: UnipilePost;
};

function safeIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Unipile sometimes returns numeric Unix timestamps (seconds or ms),
  // sometimes ISO strings, and frequently relative strings like "13h",
  // "1d", "2mo" — that's how the LinkedIn UI labels them. Convert each
  // to an absolute ISO timestamp; return null only when truly unparseable.
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value).trim();
  // Relative-time formats: "5m", "13h", "1d", "2w", "3mo", "1y".
  const rel = /^(\d+)\s*(s|m|h|d|w|mo|y)$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
      mo: 2_592_000_000, // ~30 days
      y: 31_536_000_000, // ~365 days
    };
    if (Number.isFinite(n) && ms[unit]) {
      return new Date(Date.now() - n * ms[unit]).toISOString();
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Defensive media extraction. Unipile's post payloads aren't formally
// documented in this repo and the shape varies by post type / source.
// Walk every known location, return first match. Wrap in try/catch so
// normalizePost never throws even on weird inputs.
function pickType(raw: unknown): MediaItem["type"] | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  if (s.startsWith("image/") || s === "image" || s === "photo" || s === "gif") {
    return s === "gif" ? "gif" : "image";
  }
  if (s.startsWith("video/") || s === "video") return "video";
  if (s === "application/pdf" || s.startsWith("document") || s === "pdf" || s === "document") return "document";
  if (s === "article" || s === "url" || s === "link" || s === "shared") return "article";
  return null;
}

export function extractMedia(raw: UnipilePost): {
  media_urls: MediaItem[];
  media_type: MediaType;
} {
  try {
    const out: MediaItem[] = [];

    // 1. Generic attachments array — most LinkedIn posts via Unipile
    const attachments = (raw.attachments ?? raw.media) as unknown;
    if (Array.isArray(attachments)) {
      for (const item of attachments) {
        if (!item || typeof item !== "object") continue;
        const a = item as Record<string, unknown>;
        const url =
          (a.url as string) ||
          (a.media_url as string) ||
          (a.image_url as string) ||
          (a.download_url as string) ||
          (a.video_url as string);
        if (!url) continue;
        const type =
          pickType(a.type) ||
          pickType(a.mime_type) ||
          pickType(a.media_type) ||
          (typeof url === "string" && /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : null) ||
          (typeof url === "string" && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
            ? url.endsWith(".gif")
              ? "gif"
              : "image"
            : null) ||
          "image";
        out.push({
          url,
          type,
          thumbnail_url: (a.thumbnail_url as string) || (a.poster as string) || (a.thumbnail as string),
          title: (a.title as string) || (a.name as string),
        });
      }
    }

    // 2. images array
    const images = raw.images as unknown;
    if (out.length === 0 && Array.isArray(images)) {
      for (const item of images) {
        if (typeof item === "string") {
          out.push({ url: item, type: "image" });
        } else if (item && typeof item === "object") {
          const img = item as Record<string, unknown>;
          const url = (img.url as string) || (img.image_url as string);
          if (url) out.push({ url, type: "image", thumbnail_url: img.thumbnail_url as string });
        }
      }
    }

    // 3. video object
    const video = raw.video as unknown;
    if (out.length === 0 && video && typeof video === "object") {
      const v = video as Record<string, unknown>;
      const url = (v.url as string) || (v.stream_url as string);
      if (url) {
        out.push({
          url,
          type: "video",
          thumbnail_url: (v.poster as string) || (v.thumbnail as string),
        });
      }
    }

    // 4. article / shared link / link preview
    const article =
      (raw.article as Record<string, unknown> | undefined) ??
      (raw.shared_url as Record<string, unknown> | undefined) ??
      (raw.link_preview as Record<string, unknown> | undefined);
    if (out.length === 0 && article && typeof article === "object") {
      const url = (article.url as string) || (article.link as string);
      if (url) {
        out.push({
          url,
          type: "article",
          thumbnail_url: (article.image as string) || (article.thumbnail as string),
          title: (article.title as string) || (article.name as string),
        });
      }
    }

    if (out.length === 0) {
      // Last-resort hint: post_type tells us a media kind exists somewhere
      // we didn't find. Log for iteration without surfacing media in the UI.
      const hint = pickType(raw.post_type) || pickType(raw.type);
      if (hint && hint !== "article") {
        console.warn(
          "[extractMedia] post_type suggests media but no URL found",
          JSON.stringify(raw).slice(0, 500),
        );
      }
      return { media_urls: [], media_type: "none" };
    }

    return { media_urls: out, media_type: out[0].type };
  } catch (e) {
    console.warn("[extractMedia] threw", (e as Error).message);
    return { media_urls: [], media_type: "none" };
  }
}

export function normalizePost(p: UnipilePost): NormalizedPost {
  const post_id =
    String(p.social_id ?? p.urn ?? p.id ?? "").trim() ||
    `unknown-${Math.random().toString(36).slice(2, 10)}`;
  const postedRaw = p.date ?? p.posted_at ?? p.created_at ?? null;
  const posted_at = safeIsoDate(postedRaw);
  const text = (p.text ?? p.body ?? p.commentary ?? null) as string | null;
  const { media_urls, media_type } = extractMedia(p);
  const impressionsRaw = p.impressions_counter;
  const impressions =
    typeof impressionsRaw === "number" && Number.isFinite(impressionsRaw)
      ? impressionsRaw
      : null;
  return {
    post_id,
    posted_at,
    text,
    reactions: Number(p.reaction_counter ?? 0) || 0,
    comments: Number(p.comment_counter ?? 0) || 0,
    reposts: Number(p.repost_counter ?? 0) || 0,
    impressions,
    media_urls,
    media_type,
    raw: p,
  };
}

// ---- Comments ----------------------------------------------------------

type UnipileComment = {
  id?: string;
  comment_id?: string;
  social_id?: string;
  urn?: string;
  text?: string;
  body?: string;
  commentary?: string;
  date?: string;
  posted_at?: string;
  created_at?: string;
  commenter?: Record<string, unknown>;
  author?: Record<string, unknown>;
  user?: Record<string, unknown>;
  [key: string]: unknown;
};

type CommentsPage = {
  items?: UnipileComment[];
  data?: UnipileComment[];
  comments?: UnipileComment[];
  cursor?: string;
  next_cursor?: string;
  paging?: { cursors?: { after?: string } };
};

export type NormalizedComment = {
  comment_id: string;
  text: string | null;
  posted_at: string | null;
  commenter_name: string | null;
  commenter_identifier: string | null;
};

function normalizeComment(c: UnipileComment): NormalizedComment {
  const comment_id =
    String(c.comment_id ?? c.id ?? c.social_id ?? c.urn ?? "").trim() ||
    `c-${Math.random().toString(36).slice(2, 10)}`;
  const text = (c.text ?? c.body ?? c.commentary ?? null) as string | null;
  const postedRaw = c.date ?? c.posted_at ?? c.created_at ?? null;
  const posted_at = safeIsoDate(postedRaw);
  const author = (c.commenter ?? c.author ?? c.user ?? {}) as Record<string, unknown>;
  const commenter_name =
    (author.name as string) ||
    (author.full_name as string) ||
    (author.display_name as string) ||
    null;
  const commenter_identifier =
    (author.public_identifier as string) ||
    (author.provider_id as string) ||
    (author.id as string) ||
    null;
  return { comment_id, text, posted_at, commenter_name, commenter_identifier };
}

// Single-page comment fetch for a post. 50 comment cap by default to keep
// payload manageable and stay within Hobby's 10s function ceiling on the
// caller route (~1-2s typical Unipile latency).
export async function fetchPostComments(
  postId: string,
  opts: { maxComments?: number; pageSize?: number } = {},
): Promise<NormalizedComment[]> {
  const { accountId } = await loadCreds();
  const maxComments = opts.maxComments ?? 50;
  const pageSize = opts.pageSize ?? 50;

  const params: Record<string, string | number | undefined> = {
    account_id: accountId,
    limit: pageSize,
  };

  // Primary endpoint shape: /api/v1/posts/{post_id}/comments. Some
  // Unipile deployments use /api/v1/comments?post_id=X — fall back if
  // the primary returns 404.
  let resp: CommentsPage;
  try {
    resp = await unipileFetch<CommentsPage>(
      "GET",
      `/api/v1/posts/${encodeURIComponent(postId)}/comments`,
      { params, timeoutMs: 8_000 },
    );
  } catch (e) {
    if (e instanceof UnipileError && (e.status === 404 || e.status === 405)) {
      resp = await unipileFetch<CommentsPage>(
        "GET",
        `/api/v1/comments`,
        {
          params: { ...params, post_id: postId },
          timeoutMs: 8_000,
        },
      );
    } else {
      throw e;
    }
  }

  const items = resp.items ?? resp.data ?? resp.comments ?? [];
  return items.slice(0, maxComments).map(normalizeComment);
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
