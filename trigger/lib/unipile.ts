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

/** Rich relation record returned by walkAllRelations. Fields are best-effort:
 *  Unipile does not formally document the relations item shape and multiple
 *  aliases are known (member_id vs provider_id, name vs full_name, etc.),
 *  so we normalize here and callers work off the normalized keys. */
export interface RelationRow {
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  /** Raw location string when the relations endpoint returns it inline —
   *  frequently null; caller falls back to a per-profile lookup. */
  location: string | null;
  profile_url: string | null;
  raw: Record<string, unknown>;
}

function pickLocation(raw: Record<string, unknown>): string | null {
  // Direct fields first — Unipile sometimes surfaces a plain string.
  const direct = pickStr(raw, [
    "location",
    "location_name",
    "geo_location_name",
    "region",
    "country",
  ]);
  if (direct) return direct;
  // Nested shapes.
  for (const key of ["profile", "user", "basic_info", "geo"]) {
    const nested = raw[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const v = pickStr(nested as Record<string, unknown>, [
        "location",
        "name",
        "city",
        "region",
        "country",
      ]);
      if (v) return v;
    }
  }
  return null;
}

function buildProfileUrl(row: {
  public_identifier: string | null;
  provider_id: string;
  raw: Record<string, unknown>;
}): string | null {
  const direct = pickStr(row.raw, [
    "profile_url",
    "public_profile_url",
    "linkedin_url",
    "url",
    "public_url",
  ]);
  if (direct) return direct;
  if (row.public_identifier) {
    return `https://www.linkedin.com/in/${encodeURIComponent(row.public_identifier)}/`;
  }
  return null;
}

/** Walk EVERY relation on the account (no artificial cap), yielding a
 *  normalized row per connection. Used by the pakistan-cleanup scan task
 *  and any future full-account audit. Handles cursor-based pagination
 *  cleanly and exits on the first empty page or missing cursor. */
export async function walkAllRelations(opts?: {
  pageSize?: number;
  hardCap?: number;
  onPage?: (batch: RelationRow[], pageNum: number) => Promise<void> | void;
}): Promise<RelationRow[]> {
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 100, 1), 100);
  const hardCap = opts?.hardCap ?? 50_000;
  const out: RelationRow[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pageNum = 0;
  // 500 pages @ 100/page = 50k relations, matching hardCap.
  let safety = 500;

  while (out.length < hardCap && safety-- > 0) {
    let path = `/api/v1/users/relations?account_id=${accountQ}&limit=${pageSize}`;
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
    if (items.length === 0) break;

    const batch: RelationRow[] = [];
    for (const it of items) {
      const providerId = pickStr(it, [
        "member_id",
        "provider_id",
        "member_urn",
        "id",
        "user_provider_id",
      ]);
      if (!providerId || seen.has(providerId)) continue;
      seen.add(providerId);
      const public_identifier = pickStr(it, ["public_identifier", "public_id", "vanity_name"]) ?? null;
      const full_name =
        pickStr(it, ["full_name", "name", "display_name"]) ??
        (() => {
          const first = pickStr(it, ["first_name"]);
          const last = pickStr(it, ["last_name"]);
          return first || last ? `${first ?? ""} ${last ?? ""}`.trim() : null;
        })();
      const headline = pickStr(it, ["headline", "occupation", "title", "tagline"]) ?? null;
      const row: RelationRow = {
        provider_id: providerId,
        public_identifier,
        full_name,
        headline,
        location: pickLocation(it),
        profile_url: null,
        raw: it,
      };
      row.profile_url = buildProfileUrl(row);
      batch.push(row);
    }
    out.push(...batch);
    pageNum += 1;
    if (opts?.onPage) await opts.onPage(batch, pageNum);

    cursor = resp.cursor ?? resp.next_cursor ?? resp.paging?.cursors?.after;
    if (!cursor) break;
  }
  return out;
}

/** Profile record we need for audience demographics. Fetched via
 *  GET /api/v1/users/{id}?linkedin_sections=*. Location + industry +
 *  employment fields are best-effort — Unipile's payload shape varies by
 *  profile type, so the extractors walk every known shape and take the
 *  first hit. Callers that need the untouched shape read `raw`. */
export interface UserProfileLite {
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  industry: string | null;
  current_company: string | null;
  current_role: string | null;
  profile_url: string | null;
  raw: Record<string, unknown>;
}

/** Split a "Karachi, Sindh, Pakistan" location string into (city, country).
 *  LinkedIn's location strings are comma-separated with the country last,
 *  1-3 segments deep. We take the first as city and last as country when
 *  there are at least two segments; single-segment strings usually mean
 *  the profile only lists a country. */
function splitLocation(location: string | null): { city: string | null; country: string | null } {
  if (!location) return { city: null, country: null };
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: null, country: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

/** Best-effort pluck of the current employer + title from a profile payload.
 *  Unipile puts current employment under any of these shapes depending on
 *  which LinkedIn API surface it hits — Sales Nav, Recruiter, or classic
 *  profile view. We walk every known shape and return the first hit. */
function pickEmployment(raw: Record<string, unknown>): {
  company: string | null;
  role: string | null;
} {
  // Shape 1: top-level current_position / current_company (Sales Nav)
  const cpCompany = pickStr(raw, ["current_company", "current_employer"]);
  const cpRole = pickStr(raw, ["current_position", "current_title", "occupation"]);
  if (cpCompany || cpRole) return { company: cpCompany ?? null, role: cpRole ?? null };

  // Shape 2: work_experience[] / experiences[] / positions[] — first entry
  //          is typically current on Unipile's ordering.
  for (const key of ["work_experience", "experiences", "positions", "work_experiences"]) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (first && typeof first === "object") {
        const row = first as Record<string, unknown>;
        const company =
          pickStr(row, ["company", "company_name", "organization", "employer"]) ??
          (() => {
            const nested = row.company;
            if (nested && typeof nested === "object" && !Array.isArray(nested)) {
              return pickStr(nested as Record<string, unknown>, ["name", "title"]);
            }
            return null;
          })();
        const role = pickStr(row, ["title", "position", "role", "job_title"]);
        if (company || role) return { company: company ?? null, role: role ?? null };
      }
    }
  }
  return { company: null, role: null };
}

/** Best-effort industry extraction. LinkedIn stores industry both at the
 *  profile level and under company.industry — try profile-level first. */
function pickIndustry(raw: Record<string, unknown>): string | null {
  const direct = pickStr(raw, ["industry", "industry_name"]);
  if (direct) return direct;
  // Walk into common nested paths.
  for (const key of ["profile", "user", "basic_info"]) {
    const nested = raw[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const v = pickStr(nested as Record<string, unknown>, ["industry", "industry_name"]);
      if (v) return v;
    }
  }
  // Fall back to first experience row's company.industry.
  for (const key of ["work_experience", "experiences", "positions"]) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (first && typeof first === "object") {
        const row = first as Record<string, unknown>;
        const nested = row.company;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          const v = pickStr(nested as Record<string, unknown>, ["industry"]);
          if (v) return v;
        }
      }
    }
  }
  return null;
}

export async function getUserProfileLite(
  handleOrId: string,
): Promise<UserProfileLite | null> {
  const trimmed = (handleOrId ?? "").trim();
  if (!trimmed) return null;
  const accountQ = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));
  let raw: Record<string, unknown>;
  try {
    raw = await request<Record<string, unknown>>(
      "GET",
      `/api/v1/users/${encodeURIComponent(trimmed)}?account_id=${accountQ}&linkedin_sections=*`,
    );
  } catch (e) {
    // 404 means the profile was deleted or is no longer reachable via our
    // session — treat as null so the scanner can move on.
    const msg = String((e as Error)?.message ?? e ?? "");
    if (/404/.test(msg)) return null;
    throw e;
  }
  const provider_id =
    pickStr(raw, ["provider_id", "member_urn"]) ??
    (typeof raw.id === "string" && (raw.id as string).startsWith("ACo") ? (raw.id as string) : trimmed);
  const public_identifier = pickStr(raw, ["public_identifier", "public_id", "vanity_name"]) ?? null;
  const full_name =
    pickStr(raw, ["full_name", "name", "display_name"]) ??
    (() => {
      const first = pickStr(raw, ["first_name"]);
      const last = pickStr(raw, ["last_name"]);
      return first || last ? `${first ?? ""} ${last ?? ""}`.trim() : null;
    })();
  const headline = pickStr(raw, ["headline", "occupation", "title", "tagline"]) ?? null;
  const location = pickLocation(raw);
  const directCountry = pickStr(raw, ["country", "country_name"]);
  const split = splitLocation(location);
  const country = directCountry ?? split.country;
  const employment = pickEmployment(raw);
  const industry = pickIndustry(raw);
  const profile_url =
    pickStr(raw, ["public_profile_url", "profile_url", "linkedin_url", "url"]) ??
    (public_identifier ? `https://www.linkedin.com/in/${encodeURIComponent(public_identifier)}/` : null);
  return {
    provider_id,
    public_identifier,
    full_name,
    headline,
    location,
    city: split.city,
    country: country ?? null,
    industry,
    current_company: employment.company,
    current_role: employment.role,
    profile_url,
    raw,
  };
}

// ---- Own account profile fetch -----------------------------------------

/** Fetch our own LinkedIn profile. Two-step:
 *   1. GET /api/v1/accounts/{id} → walk payload for the ACo... identifier
 *   2. GET /api/v1/users/{aco} → full profile with follower/connection counts
 * Used by snapshot-own-account daily task. */
export interface OwnProfileSnapshot {
  provider_id: string;
  public_identifier: string | null;
  display_name: string | null;
  headline: string | null;
  picture_url: string | null;
  followers_count: number | null;
  connections_count: number | null;
  raw: Record<string, unknown>;
}

function findAcoIdentifier(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) findAcoIdentifier(item, out);
    return;
  }
  for (const [, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "string" && v.startsWith("ACo") && v.length > 5) out.push(v);
    findAcoIdentifier(v, out);
  }
}

export async function fetchOwnProfileSnapshot(): Promise<OwnProfileSnapshot> {
  const accountId = env("UNIPILE_LINKEDIN_ACCOUNT_ID");
  const account = await request<Record<string, unknown>>(
    "GET",
    `/api/v1/accounts/${encodeURIComponent(accountId)}`,
  );
  const found: string[] = [];
  findAcoIdentifier(account, found);
  const aco = found[0];
  if (!aco) throw new Error("fetchOwnProfileSnapshot: no ACo... identifier in account payload");

  const accountQ = encodeURIComponent(accountId);
  const profile = await request<Record<string, unknown>>(
    "GET",
    `/api/v1/users/${encodeURIComponent(aco)}?account_id=${accountQ}&linkedin_sections=*`,
  );

  const pickNum = (obj: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    }
    const nd = obj.network_distance;
    if (nd && typeof nd === "object" && !Array.isArray(nd)) {
      for (const k of keys) {
        const v = (nd as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
    }
    return null;
  };

  const public_identifier = pickStr(profile, ["public_identifier", "public_id", "vanity_name"]) ?? null;
  const display_name =
    pickStr(profile, ["full_name", "name", "display_name"]) ??
    (() => {
      const first = pickStr(profile, ["first_name"]);
      const last = pickStr(profile, ["last_name"]);
      return first || last ? `${first ?? ""} ${last ?? ""}`.trim() : null;
    })();
  const headline = pickStr(profile, ["headline", "occupation", "title", "tagline"]) ?? null;
  const picture_url = pickStr(profile, [
    "profile_picture_url",
    "profile_picture_url_large",
    "picture_url",
    "image_url",
    "avatar_url",
  ]) ?? null;
  const followers_count = pickNum(profile, ["followers_count", "followers", "follower_count"]);
  const connections_count = pickNum(profile, ["connections_count", "connections", "connection_count"]);

  return {
    provider_id: aco,
    public_identifier,
    display_name,
    headline,
    picture_url,
    followers_count,
    connections_count,
    raw: profile,
  };
}

// ---- Fetch post reactions (mirror of fetchPostComments) ----------------

export interface UnipileReaction {
  provider_id: string | null;
  full_name: string | null;
  headline: string | null;
  profile_url: string | null;
  reaction_type: string | null;
  raw: Record<string, unknown>;
}

interface ReactionListResponse {
  items?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  reactions?: Array<Record<string, unknown>>;
}

/** Fetch reactions on a post. Same URN-alternate strategy as
 *  fetchPostComments — Unipile is finicky about which post_id shape it
 *  accepts and disagreement varies per DSN. */
export async function fetchPostReactions(postId: string): Promise<UnipileReaction[]> {
  const accountId = encodeURIComponent(env("UNIPILE_LINKEDIN_ACCOUNT_ID"));

  const isUrn = /^urn:li:[a-zA-Z]+:\d+$/.test(postId);
  const numericMatch = postId.match(/^\d+$/);
  const candidates = isUrn
    ? [postId]
    : numericMatch
      ? [
          `urn:li:activity:${postId}`,
          `urn:li:share:${postId}`,
          `urn:li:ugcPost:${postId}`,
          postId,
        ]
      : [postId];

  let lastErr: unknown = null;
  for (const candidate of candidates) {
    const encoded = encodeURIComponent(candidate);
    try {
      const r = await request<ReactionListResponse>(
        "GET",
        `/api/v1/posts/${encoded}/reactions?account_id=${accountId}`,
      );
      const items = r.items ?? r.data ?? r.reactions ?? [];
      return items.map(normalizeReaction);
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      const isInvalidId =
        /400/.test(msg) &&
        /invalid post_id|errors\/malformed_request|errors\/invalid_parameters/.test(msg);
      if (!isInvalidId) break;
    }
  }
  throw lastErr ?? new Error("fetchPostReactions: all candidates failed");
}

function normalizeReaction(r: Record<string, unknown>): UnipileReaction {
  const author =
    (r.author_details as Record<string, unknown> | undefined) ??
    (r.commenter as Record<string, unknown> | undefined) ??
    (r.user as Record<string, unknown> | undefined) ??
    (typeof r.author === "object" && r.author ? (r.author as Record<string, unknown>) : undefined) ??
    {};
  const provider_id =
    pickStr(author, ["id", "provider_id", "public_identifier"]) ??
    pickStr(r, ["author_id", "provider_id", "member_id"]);
  const full_name =
    (typeof r.author === "string" && r.author.trim()) ||
    pickStr(author, ["name", "full_name", "display_name"]) ||
    null;
  const headline =
    pickStr(author, ["headline", "occupation", "title"]) ?? pickStr(r, ["headline"]) ?? null;
  const profile_url =
    pickStr(author, ["profile_url", "public_profile_url", "linkedin_url"]) ??
    pickStr(r, ["profile_url"]) ??
    null;
  const reaction_type = pickStr(r, ["type", "reaction_type", "value"]) ?? null;
  return { provider_id: provider_id ?? null, full_name, headline, profile_url, reaction_type, raw: r };
}

// ---- Cancel a sent invitation ------------------------------------------

/** Withdraw an outbound connection request that hasn't been accepted yet.
 *  Wraps Unipile's cancel-invite endpoint. Takes the same provider_id we
 *  used with sendInvitation — Unipile resolves it to the pending
 *  invitation id server-side. */
export async function cancelInvitation(providerId: string): Promise<{ ok: boolean; raw: unknown }> {
  const trimmed = (providerId ?? "").trim();
  if (!trimmed) throw new Error("cancelInvitation: providerId is required");
  const accountId = env("UNIPILE_LINKEDIN_ACCOUNT_ID");
  // Unipile's documented shape uses DELETE /api/v1/users/invite/{provider_id}
  // with account_id as a query param. The DSN doesn't always accept
  // path-style, so we also allow the alternate body form via POST /users/invite/cancel.
  const path = `/api/v1/users/invite/${encodeURIComponent(trimmed)}?account_id=${encodeURIComponent(accountId)}`;
  try {
    const raw = await request<unknown>("DELETE", path);
    return { ok: true, raw };
  } catch (e) {
    const msg = String((e as Error).message);
    // Fall back to the body-shaped alternate if DSN rejects the path form.
    if (/404|405/.test(msg)) {
      const raw = await request<unknown>("POST", `/api/v1/users/invite/cancel`, {
        provider_id: trimmed,
        account_id: accountId,
      });
      return { ok: true, raw };
    }
    throw e;
  }
}

// ---- List followers via Voyager pass-through (ban-risk-gated) -----------

export interface FollowerRow {
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  profile_url: string | null;
  raw: Record<string, unknown>;
}

/**
 * Fetch a page of followers via Unipile's raw-data pass-through to
 * LinkedIn's internal Voyager endpoint. This is NOT a documented Unipile
 * capability — we're proxying arbitrary requests through their /linkedin
 * endpoint. See scripts/pakistan_disconnect.mjs for the same pattern.
 *
 * Ban risk is real: bulk enumeration of your followers is not normal user
 * behavior. Callers must respect the budget cap in scan_followers.ts and
 * pace at 30s+ per call with jitter.
 *
 * Endpoint: GET voyager/api/identity/dash/profileMemberFollowers
 * The `followedMember` URN parameter needs the caller's own fsd_profile
 * URN — we let Voyager infer it from the authenticated session by
 * omitting it and using the `q=followed` variant that defaults to "me".
 */
export async function listFollowersViaVoyager(opts: {
  start: number;
  count: number;
}): Promise<{ items: FollowerRow[]; total: number | null }> {
  const accountId = env("UNIPILE_LINKEDIN_ACCOUNT_ID");
  const requestUrl =
    `https://www.linkedin.com/voyager/api/identity/dash/profileMemberFollowers` +
    `?q=followed&start=${opts.start}&count=${Math.min(Math.max(opts.count, 1), 40)}`;
  const body = {
    account_id: accountId,
    method: "GET",
    request_url: requestUrl,
    encoding: false,
  };
  const res = await fetch(`${baseUrl()}/api/v1/linkedin`, {
    method: "POST",
    headers: {
      "X-API-KEY": env("UNIPILE_API_KEY"),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`listFollowersViaVoyager -> ${res.status}: ${raw.slice(0, 400)}`);
  }
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  // Voyager wraps results under "elements" or "data.*Elements" depending on the API version.
  const elements =
    (parsed.elements as Array<Record<string, unknown>> | undefined) ??
    (() => {
      const data = parsed.data as Record<string, unknown> | undefined;
      if (data) {
        for (const [, v] of Object.entries(data)) {
          if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
        }
      }
      return [] as Array<Record<string, unknown>>;
    })();
  const paging = parsed.paging as { total?: number } | undefined;
  const items: FollowerRow[] = elements.map((el) => {
    // Voyager elements are richly nested; the member urn lives under
    // followerMemberProfile.entityUrn or similar. Defensively walk it.
    const walk = JSON.stringify(el);
    const urnMatch = walk.match(/urn:li:(?:fsd_)?profile:([A-Za-z0-9_-]+)/);
    const provider_id = urnMatch ? urnMatch[1] : "";
    const public_identifier = pickStr(el, ["publicIdentifier", "public_identifier"]) ?? null;
    const full_name =
      pickStr(el, ["firstName"]) && pickStr(el, ["lastName"])
        ? `${pickStr(el, ["firstName"])} ${pickStr(el, ["lastName"])}`.trim()
        : pickStr(el, ["name", "displayName"]) ?? null;
    const headline = pickStr(el, ["headline", "occupation"]) ?? null;
    const location = pickStr(el, ["geoLocationName", "locationName", "location"]) ?? null;
    const profile_url = public_identifier
      ? `https://www.linkedin.com/in/${encodeURIComponent(public_identifier)}/`
      : null;
    return { provider_id, public_identifier, full_name, headline, location, profile_url, raw: el };
  }).filter((r) => r.provider_id);
  return { items, total: paging?.total ?? null };
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
