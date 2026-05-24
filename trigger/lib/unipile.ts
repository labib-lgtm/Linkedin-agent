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

/** Post a comment on a post, OR (when parentCommentId is provided) post a
 *  threaded reply to an existing comment. Without parentCommentId,
 *  Unipile creates a top-level comment on the post.
 *
 *  Unipile's field for "the comment to reply to" is `comment_id`
 *  (https://developer.unipile.com/reference/postscontroller_sendcomment).
 *  Unknown fields are silently dropped, so passing the wrong name posts
 *  a top-level comment instead of a reply. */
export async function postComment(args: {
  postId: string;
  text: string;
  parentCommentId?: string;
}): Promise<{ id?: string }> {
  const body: Record<string, unknown> = {
    account_id: env("UNIPILE_LINKEDIN_ACCOUNT_ID"),
    text: args.text,
  };
  if (args.parentCommentId) {
    body.comment_id = args.parentCommentId;
  }
  return request("POST", `/api/v1/posts/${args.postId}/comments`, body);
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

/** A message in a chat. `is_sender` true = our account sent it; false =
 *  the other person (the prospect) sent it — i.e. a reply. */
export interface ChatMessage {
  is_sender: boolean;
  text: string;
  date: string | null;
}

/** List recent messages in a chat (most recent first). Used to detect a
 *  prospect's reply to our DM: any message with is_sender=false. */
export async function listChatMessages(chatId: string, limit = 20): Promise<ChatMessage[]> {
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  const resp = await request<{ items?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }>(
    "GET",
    `/api/v1/chats/${encodeURIComponent(chatId)}/messages?account_id=${accountQ}&limit=${limit}`,
  );
  const items = resp.items ?? resp.data ?? [];
  return items.map((m) => ({
    is_sender: m.is_sender === true,
    text: String(m.text ?? m.body ?? m.message ?? ""),
    date: (m.date ?? m.timestamp ?? m.created_at ?? null) as string | null,
  }));
}

/** Send a LinkedIn connection request (invitation).
 *  Endpoint per Unipile docs: POST /api/v1/users/invite with
 *  { provider_id, account_id, message }. The optional message is the
 *  connection note (LinkedIn caps it ~200-300 chars). */
export async function sendInvitation(args: {
  providerId: string;
  message?: string;
}): Promise<{ id?: string; invitation_id?: string }> {
  const body: Record<string, unknown> = {
    provider_id: args.providerId,
    account_id: env("UNIPILE_LINKEDIN_ACCOUNT_ID"),
  };
  if (args.message && args.message.trim()) body.message = args.message.trim();
  return request("POST", `/api/v1/users/invite`, body);
}

/** List the account's LinkedIn relations (connections), most recent first.
 *  Used to detect accepted invitations: a prospect's cached provider_id
 *  appearing here means they accepted. Response shape isn't formally
 *  documented, so we extract the member id defensively from each item. */
export async function getRelations(limit = 200): Promise<string[]> {
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  const ids = new Set<string>();
  let cursor: string | undefined;
  let safety = 10;
  while (ids.size < limit && safety-- > 0) {
    let path = `/api/v1/users/relations?account_id=${accountQ}&limit=${Math.min(limit, 100)}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const resp = await request<{
      items?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
      relations?: Array<Record<string, unknown>>;
      cursor?: string;
      next_cursor?: string;
      paging?: { cursors?: { after?: string } };
    }>("GET", path);
    const items = resp.items ?? resp.data ?? resp.relations ?? [];
    for (const it of items) {
      const id = pickStr(it, [
        "member_id",
        "provider_id",
        "member_urn",
        "id",
        "public_identifier",
        "user_provider_id",
      ]);
      if (id) ids.add(id);
    }
    cursor = resp.cursor ?? resp.next_cursor ?? resp.paging?.cursors?.after;
    if (!cursor || items.length === 0) break;
  }
  return [...ids];
}

/** Comment on a published post. Shape from live Unipile responses:
 *    { id, post_id, post_urn, date, text,
 *      author: "Display Name",                       // string, NOT object
 *      author_details: { id, headline, profile_url, profile_picture_url },
 *      reaction_counter, reply_counter, ... }
 *  Older shape variants (commenter / user as objects) are still tolerated
 *  to keep the monitor robust if Unipile changes the surface again. */
export interface UnipileComment {
  id?: string;
  comment_id?: string;
  social_id?: string;
  urn?: string;
  text?: string;
  body?: string;
  commentary?: string;
  // Current Unipile shape:
  author?: string | { id?: string; provider_id?: string; public_identifier?: string; name?: string; full_name?: string; display_name?: string };
  author_details?: { id?: string; provider_id?: string; public_identifier?: string; profile_url?: string; headline?: string };
  // Legacy fallbacks:
  commenter?: { id?: string; provider_id?: string; public_identifier?: string; name?: string; full_name?: string; display_name?: string };
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

/** Best-effort commenter id (used as DM recipient_id).
 *  Current Unipile shape exposes the LinkedIn member URN at
 *  `author_details.id`. Older shapes are checked as fallbacks. */
export function commenterId(c: UnipileComment): string {
  const ad = c.author_details;
  if (ad) {
    const id = ad.id ?? ad.provider_id ?? ad.public_identifier;
    if (id) return String(id);
  }
  for (const node of [c.commenter, c.user]) {
    if (node) {
      const id = node.id ?? node.provider_id ?? node.public_identifier;
      if (id) return String(id);
    }
  }
  if (c.author && typeof c.author === "object") {
    const id = c.author.id ?? c.author.provider_id ?? c.author.public_identifier;
    if (id) return String(id);
  }
  return String(c.commenter_id ?? c.author_id ?? "");
}

/** Best-effort commenter display name.
 *  Current Unipile shape returns `author` as a plain string. */
export function commenterName(c: UnipileComment): string {
  if (typeof c.author === "string" && c.author.trim()) return c.author.trim();
  for (const node of [c.commenter, c.user]) {
    if (node) {
      const name = node.name ?? node.full_name ?? node.display_name;
      if (name) return String(name);
    }
  }
  if (c.author && typeof c.author === "object") {
    const name = c.author.name ?? c.author.full_name ?? c.author.display_name;
    if (name) return String(name);
  }
  return "";
}

/** Result shape for a company-search match.
 *
 *  Unipile's company-search response (both Sales Nav and Classic) uses a
 *  stringified numeric LinkedIn company ID under `id` (e.g. `"103848457"`),
 *  NOT a `urn:li:fs_salesCompany:...` URN. The numeric form is what
 *  Sales Nav's people search filter `company.include` expects. We keep
 *  `numericId` separate (as a real number) for that filter, and keep the
 *  string `id` for storage in our existing `linkedin_company_urn` column.
 *
 *  See: https://developer.unipile.com/docs/linkedin-search.md */
export interface CompanyMatch {
  numericId: number | null;
  id?: string;
  url?: string;
  name?: string;
  industry?: string;
  location?: string;
  summary?: string;
}

interface SearchListResponse {
  items?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
  paging?: unknown;
  cursor?: unknown;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Extract a positive integer LinkedIn ID from a response field. Handles
 *  both raw numbers (`123`) and stringified numerics (`"123"`); also pulls
 *  the trailing digits out of URN-shaped strings as a last resort. */
function pickNumericId(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (/^\d+$/.test(trimmed)) {
        const n = parseInt(trimmed, 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const m = trimmed.match(/:(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

/** Case-insensitive headline match against the decision-maker title list.
 *  Substring match so "Senior Marketing Manager" hits "Marketing Manager"
 *  and "Founder & CEO at X" hits both "Founder" and "CEO". Operator does
 *  the final pruning in the prospects table. */
function headlineMatchesDecisionMaker(headline: string | undefined): boolean {
  if (!headline) return false;
  const h = headline.toLowerCase();
  return DECISION_MAKER_TITLES.some((t) => h.includes(t.toLowerCase()));
}

/** Decision-maker titles for Sales Nav lead search. Broad coverage of
 *  founder + commerce/marketing leadership at Amazon seller brands.
 *  LinkedIn matches these fuzzily (e.g. "Marketing Manager" surfaces
 *  "Senior Marketing Manager" too) which is usually desirable. */
export const DECISION_MAKER_TITLES = [
  "Founder",
  "CEO",
  "Owner",
  "Co-Founder",
  "President",
  "CMO",
  "CGO",
  "COO",
  "Head of E-commerce",
  "Head of Marketing",
  "Head of Growth",
  "VP Marketing",
  "VP of Marketing",
  "Director of E-commerce",
  "Director of Marketing",
  "Brand Manager",
  "Marketing Manager",
  "Ecommerce Manager",
];

/** Search LinkedIn for companies by name. Returns up to `limit` candidate
 *  matches (top result first), each with its numeric LinkedIn company ID.
 *
 *  Returns MULTIPLE candidates because company names collide: a search for
 *  "Arc Solutions" returns both a consulting firm and the welding/plasma
 *  manufacturer that's the actual Amazon seller. The caller picks the right
 *  one (by industry/location) instead of blindly trusting result #1.
 *
 *  Uses Unipile's `classic` company search ONLY — not Sales Navigator.
 *  Both return the same numeric LinkedIn company ID under `id`, which is
 *  all we need to feed into the Sales Nav people search filter
 *  (`company.include`). Classic has a much higher rate-limit budget on
 *  LinkedIn's side, so we reserve our Sales Nav quota (~250/day on
 *  Standard tier) exclusively for `getCompanyEmployees`.
 *
 *  Classic company response shape per docs:
 *    { type: "COMPANY", id: "165158", name, profile_url,
 *      industry, location, followers_count, job_offers_count }
 *
 *  Auth/5xx/429 errors propagate so we hear about real failures instead
 *  of silently turning a rate-limit into a no_match. */
export async function searchCompanies(query: string, limit = 5): Promise<CompanyMatch[]> {
  const accountId = env("UNIPILE_LINKEDIN_ACCOUNT_ID");
  const accountQ = encodeURIComponent(accountId);
  const q = query.trim();
  if (!q) return [];

  const path = `/api/v1/linkedin/search?account_id=${accountQ}`;
  const r = await request<SearchListResponse>("POST", path, {
    api: "classic",
    category: "companies",
    keywords: q,
    limit,
  });
  const items = r.items ?? r.data ?? r.results ?? [];
  return items.slice(0, limit).map((item) => {
    const numericId = pickNumericId(item, ["id", "company_id", "provider_id"]);
    return {
      numericId,
      id: numericId !== null ? String(numericId) : pickStr(item, ["id"]),
      url: pickStr(item, ["profile_url", "url", "linkedin_url", "company_url", "public_url"]),
      name: pickStr(item, ["name", "display_name", "title"]),
      industry: pickStr(item, ["industry"]),
      location: pickStr(item, ["location", "headquarters"]),
      summary: pickStr(item, ["summary", "description", "tagline"]),
    };
  });
}

/** Result shape for an employee/profile match. */
export interface EmployeeMatch {
  name?: string;
  headline?: string;
  profile_url?: string;
  provider_id?: string;
}

/** List decision-makers at a LinkedIn company via Sales Navigator lead
 *  search. Body shape derived from the Unipile schema dump (returned by
 *  the API in 400 errors — authoritative, more reliable than the rendered
 *  docs examples which had number-vs-string ambiguity that cost us hours):
 *
 *    POST /api/v1/linkedin/search?account_id=...
 *    {
 *      "api": "sales_navigator",
 *      "category": "people",
 *      "company": { "include": ["<numericIdAsString>"] },
 *      "role":    { "include": ["Founder", "CEO", ...] }
 *    }
 *
 *  Critical gotchas from live debugging:
 *
 *  1. `company.include` items are STRINGS, not numbers. The schema is
 *     `{ type: "string", pattern: ".+" }`. Sending `[<int>]` returns
 *     `400 errors/invalid_parameters` despite the docs rendering integers
 *     in the example body — the schema wins.
 *  2. `role.include` accepts plain-text current job titles (per the
 *     schema's "You can also set a plain text job title instead." note).
 *     This is real title filtering at LinkedIn's side — better than the
 *     keyword-string hack I tried earlier.
 *  3. `keywords` is NOT required on this shape (`required: ["api","category"]`).
 *     We omit it.
 *
 *  After Unipile returns, we filter client-side against
 *  DECISION_MAKER_TITLES (case-insensitive headline substring) as a
 *  precision pass — LinkedIn's title matching is fuzzy and may surface
 *  related titles we don't want. */
export async function getCompanyEmployees(
  numericCompanyId: number,
  limit = 10,
): Promise<EmployeeMatch[]> {
  if (!Number.isFinite(numericCompanyId) || numericCompanyId <= 0) {
    throw new Error(
      `getCompanyEmployees: numericCompanyId must be a positive integer, got ${numericCompanyId}`,
    );
  }
  const accountId = env("UNIPILE_LINKEDIN_ACCOUNT_ID");
  const accountQ = encodeURIComponent(accountId);

  const body = {
    api: "sales_navigator",
    category: "people",
    company: { include: [String(numericCompanyId)] },
    role: { include: DECISION_MAKER_TITLES },
  };

  const r = await request<SearchListResponse>(
    "POST",
    `/api/v1/linkedin/search?account_id=${accountQ}`,
    body,
  );
  const items = r.items ?? r.data ?? r.results ?? [];

  const filtered = items.filter((p) =>
    headlineMatchesDecisionMaker(pickStr(p, ["headline", "title", "occupation"])),
  );

  return filtered.slice(0, limit).map((p) => ({
    name: pickStr(p, ["name", "full_name", "display_name", "first_name_last_name"]),
    headline: pickStr(p, ["headline", "title", "occupation"]),
    profile_url: pickStr(p, [
      "public_profile_url",
      "linkedin_url",
      "public_url",
      "profile_url",
      "url",
    ]),
    provider_id: pickStr(p, ["member_urn", "public_identifier", "id", "provider_id"]),
  }));
}

/* ----------------------------------------------------------------------
 * Person post-fetching (ported from webapp/lib/unipile.ts).
 *
 * Used by the prospect-engagement worker to track a person's recent
 * LinkedIn posts so we can comment on them. LinkedIn provider IDs start
 * with "ACo" and are the canonical user key; a vanity slug from a
 * /in/<slug>/ URL must be resolved to a provider_id before /posts works.
 * -------------------------------------------------------------------- */

export interface UnipilePost {
  id?: string;
  social_id?: string;
  urn?: string;
  text?: string;
  body?: string;
  commentary?: string;
  date?: string;
  posted_at?: string;
  created_at?: string;
  reaction_counter?: number;
  comment_counter?: number;
  repost_counter?: number;
  [key: string]: unknown;
}

export interface NormalizedProspectPost {
  post_id: string;
  posted_at: string | null;
  text: string | null;
  reactions: number;
  comments: number;
  reposts: number;
  raw: UnipilePost;
}

function isProviderId(s: string): boolean {
  return s.startsWith("ACo") && s.length > 5;
}

/** Extract a LinkedIn handle (or pass through a provider_id) from a
 *  profile URL or bare string. Returns null if nothing usable. */
export function identifierFromProfileUrl(url: string): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  const m = /linkedin\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?in\/([^/?#\s]+)/i.exec(trimmed);
  if (m) return decodeURIComponent(m[1]);
  if (/^[a-z0-9][a-z0-9_-]{2,}$/i.test(trimmed)) return trimmed;
  if (/^ACo[A-Za-z0-9_-]{4,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Convert Unipile's varied date formats (numeric epoch, ISO, or relative
 *  like "13h"/"2mo") to an absolute ISO string, or null. */
function safeIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value).trim();
  const rel = /^(\d+)\s*(s|m|h|d|w|mo|y)$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms: Record<string, number> = {
      s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000,
      w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000,
    };
    if (Number.isFinite(n) && ms[unit]) {
      return new Date(Date.now() - n * ms[unit]).toISOString();
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Resolve a vanity slug (or provider_id) to the canonical provider_id.
 *  Pass-through if already an ACo… id. */
export async function resolveProviderId(handleOrId: string): Promise<string> {
  const trimmed = (handleOrId ?? "").trim();
  if (!trimmed) throw new Error("resolveProviderId: empty identifier");
  if (isProviderId(trimmed)) return trimmed;
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  const profile = await request<Record<string, unknown>>(
    "GET",
    `/api/v1/users/${encodeURIComponent(trimmed)}?account_id=${accountQ}&linkedin_sections=*`,
  );
  const pid =
    (typeof profile.provider_id === "string" && profile.provider_id) ||
    (typeof profile.id === "string" && profile.id.startsWith("ACo") ? (profile.id as string) : null);
  if (!pid) {
    throw new Error(`resolveProviderId: could not resolve "${trimmed}"`);
  }
  return pid;
}

/** Fetch a person's recent posts. Accepts a handle, profile URL, or
 *  provider_id; resolves to a provider_id first when needed. Returns the
 *  normalized posts plus the resolved providerId (cache it on the caller). */
export async function fetchUserPosts(
  handleOrId: string,
  opts: {
    maxPosts?: number;
    pageSize?: number;
    providerId?: string;
    authoredOnly?: boolean;
  } = {},
): Promise<{ posts: NormalizedProspectPost[]; providerId: string }> {
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  const providerId =
    opts.providerId && isProviderId(opts.providerId)
      ? opts.providerId
      : await resolveProviderId(handleOrId);
  const maxPosts = opts.maxPosts ?? 20;
  const pageSize = opts.pageSize ?? Math.min(maxPosts, 50);

  const raw: UnipilePost[] = [];
  let cursor: string | undefined;
  let safety = 10;
  while (raw.length < maxPosts && safety-- > 0) {
    let path = `/api/v1/users/${encodeURIComponent(providerId)}/posts?account_id=${accountQ}&limit=${pageSize}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const resp = await request<{
      items?: UnipilePost[];
      data?: UnipilePost[];
      cursor?: string;
      next_cursor?: string;
      paging?: { cursors?: { after?: string } };
    }>("GET", path);
    const items = resp.items ?? resp.data ?? [];
    raw.push(...items);
    cursor = resp.cursor ?? resp.next_cursor ?? resp.paging?.cursors?.after;
    if (!cursor || items.length === 0) break;
  }

  // When authoredOnly, drop reshares/reposts: the /users/{id}/posts feed
  // includes content the user reposted, where `author` is the ORIGINAL poster
  // (a company, news org, or peer). Commenting on those lands on the original
  // author's post, not the prospect's own content. Keep only original posts the
  // prospect actually wrote (not a repost, and authored by this provider_id).
  const authoredOnly = opts.authoredOnly ?? false;
  const considered = authoredOnly
    ? raw.filter((p) => {
        if (p.is_repost === true) return false;
        const a = p.author as { id?: string } | string | undefined;
        const authorId = typeof a === "object" && a ? a.id : undefined;
        return !authorId || authorId === providerId;
      })
    : raw;

  const posts = considered.slice(0, maxPosts).map((p) => ({
    post_id:
      String(p.social_id ?? p.urn ?? p.id ?? "").trim() ||
      `unknown-${Math.random().toString(36).slice(2, 10)}`,
    posted_at: safeIsoDate(p.date ?? p.posted_at ?? p.created_at ?? null),
    text: (p.text ?? p.body ?? p.commentary ?? null) as string | null,
    reactions: Number(p.reaction_counter ?? 0) || 0,
    comments: Number(p.comment_counter ?? 0) || 0,
    reposts: Number(p.repost_counter ?? 0) || 0,
    raw: p,
  }));
  return { posts, providerId };
}
