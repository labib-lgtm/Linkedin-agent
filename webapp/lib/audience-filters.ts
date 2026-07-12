import "server-only";

// Shared filter shape for the Audience tab. Parsed from POST bodies and
// URL query strings; applied to audience_connections and target_segments
// queries so counts stay consistent across the preview / list / gap
// endpoints.

export interface AudienceFilter {
  country?: string | null;
  city?: string | null;
  industry?: string | null;
  role_contains?: string | null;
  company_contains?: string | null;
  search?: string | null;
}

export interface SegmentDefinition {
  industries: string[];
  role_keywords: string[];
  locations: string[];
  company_size_min?: number | null;
  company_size_max?: number | null;
}

function normStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function parseAudienceFilterFromSearchParams(sp: URLSearchParams): AudienceFilter {
  return {
    country: sp.get("country"),
    city: sp.get("city"),
    industry: sp.get("industry"),
    role_contains: sp.get("role_contains"),
    company_contains: sp.get("company_contains"),
    search: sp.get("search"),
  };
}

// Apply the filter to a Supabase query builder over audience_connections
// or audience_followers. Same shape either way.
//
// Caller is responsible for chaining .select(...) / .eq("account_id", ...)
// before passing the query in.
export function applyAudienceFilter<T extends { eq: Function; ilike: Function; or: Function }>(
  query: T,
  f: AudienceFilter,
): T {
  let q: any = query;
  if (f.country) q = q.eq("country", f.country);
  if (f.city) q = q.eq("city", f.city);
  if (f.industry) q = q.eq("industry", f.industry);
  if (f.role_contains) q = q.ilike("job_title", `%${f.role_contains}%`);
  if (f.company_contains) q = q.ilike("current_company", `%${f.company_contains}%`);
  if (f.search) {
    const s = f.search.replaceAll("%", "").replaceAll(",", "");
    q = q.or(
      `full_name.ilike.%${s}%,headline.ilike.%${s}%,current_company.ilike.%${s}%`,
    );
  }
  return q as T;
}

// Apply a segment definition against a query. Uses OR-within-array and
// AND-across-columns semantics — the same shape the mine-engagers task
// uses to compute matched_segment_ids. Empty arrays mean "no filter on
// that column."
export function applySegmentFilter<T extends { or: Function; gte: Function; lte: Function; not: Function }>(
  query: T,
  seg: SegmentDefinition,
): T {
  let q: any = query;

  // Industry: any-of
  if (seg.industries.length > 0) {
    const clauses = seg.industries.map((i) => `industry.ilike.%${i.replaceAll("%", "").replaceAll(",", "")}%`);
    q = q.or(clauses.join(","));
  }

  // Role keywords: any-of, matched against job_title OR headline
  if (seg.role_keywords.length > 0) {
    const clauses = seg.role_keywords.flatMap((k) => {
      const kSafe = k.replaceAll("%", "").replaceAll(",", "");
      return [`job_title.ilike.%${kSafe}%`, `headline.ilike.%${kSafe}%`];
    });
    q = q.or(clauses.join(","));
  }

  // Locations: any-of, matched against location OR city OR country
  if (seg.locations.length > 0) {
    const clauses = seg.locations.flatMap((l) => {
      const lSafe = l.replaceAll("%", "").replaceAll(",", "");
      return [
        `location.ilike.%${lSafe}%`,
        `city.ilike.%${lSafe}%`,
        `country.ilike.%${lSafe}%`,
      ];
    });
    q = q.or(clauses.join(","));
  }

  // Company size filters against a companies-side table would go here; we
  // don't currently persist per-connection company size so this is a
  // placeholder no-op for now.
  return q as T;
}

export function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ParsedSegmentBody {
  name: string;
  industries: string[];
  role_keywords: string[];
  locations: string[];
  company_size_min: number | null;
  company_size_max: number | null;
  notes: string | null;
  weekly_quota: number;
  // Outbound engine fields (migration 031). All optional on the
  // wire; null-through when absent so PATCH callers don't have to
  // resend the whole shape to touch just one field.
  invite_template: string | null;
  dm_template: string | null;
  dm_followup_template: string | null;
  daily_send_cap: number | null;
  auto_send: boolean | null;
}

// LinkedIn's connection-note character cap. Enforce in-app so a bad UI
// state can't produce a payload the API rejects.
const INVITE_NOTE_MAX = 200;

export function parseSegmentBody(body: unknown): ParsedSegmentBody | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const name = normStr(o.name);
  if (!name) return null;
  const arr = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
  };
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const boolOrNull = (v: unknown): boolean | null => {
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return null;
  };
  const invite = normStr(o.invite_template);
  const dailyCap = num(o.daily_send_cap);
  return {
    name,
    industries: arr(o.industries),
    role_keywords: arr(o.role_keywords),
    locations: arr(o.locations),
    company_size_min: num(o.company_size_min),
    company_size_max: num(o.company_size_max),
    notes: normStr(o.notes),
    weekly_quota: Math.max(1, Math.min(Number(o.weekly_quota) || 20, 100)),
    invite_template: invite ? invite.slice(0, INVITE_NOTE_MAX) : null,
    dm_template: normStr(o.dm_template),
    dm_followup_template: normStr(o.dm_followup_template),
    daily_send_cap: dailyCap == null ? null : Math.max(1, Math.min(dailyCap, 20)),
    auto_send: boolOrNull(o.auto_send),
  };
}
