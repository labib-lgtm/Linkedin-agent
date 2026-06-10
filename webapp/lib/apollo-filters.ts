import "server-only";

// Shared filter shape for the Apollo prospect tab. Parsed from POST bodies
// (the enrich endpoint) and from URL query strings (the preview / list /
// export endpoints). Re-applied identically across all four so the user
// sees consistent counts and the right seller set gets enriched.

export interface SellerFilter {
  category?: string | null;
  min_revenue?: number | null;
  max_revenue?: number | null;
  min_growth?: number | null;
  max_asins?: number | null;
  matched_only?: boolean;
  exclude_enrolled?: boolean;
  only_pending_filter?: boolean;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === "1" || v === 1;
}

export function parseFilterFromSearchParams(sp: URLSearchParams): SellerFilter {
  return {
    category: sp.get("category") || null,
    min_revenue: num(sp.get("min_revenue")),
    max_revenue: num(sp.get("max_revenue")),
    min_growth: num(sp.get("min_growth")),
    max_asins: num(sp.get("max_asins")),
    matched_only: bool(sp.get("matched_only")),
    exclude_enrolled: bool(sp.get("exclude_enrolled")),
    only_pending_filter: bool(sp.get("only_pending_filter")),
  };
}

export function parseFilterFromBody(body: unknown): SellerFilter {
  if (!body || typeof body !== "object") return {};
  const o = body as Record<string, unknown>;
  return {
    category: typeof o.category === "string" ? o.category : null,
    min_revenue: num(o.min_revenue),
    max_revenue: num(o.max_revenue),
    min_growth: num(o.min_growth),
    max_asins: num(o.max_asins),
    matched_only: bool(o.matched_only),
    exclude_enrolled: bool(o.exclude_enrolled),
    only_pending_filter: bool(o.only_pending_filter),
  };
}

// Apply the filter to a sellers query builder. Caller is responsible for
// chaining .select(...) / .eq("account_id", ...) before passing the query
// here, and for awaiting it after.
//
// PostgrestFilterBuilder is private — use the generic SbQuery type alias so
// callers can pass any flavour (select builder, head:true builder, etc).
export function applySellerFilter<T extends { eq: Function; gte: Function; lte: Function }>(
  query: T,
  f: SellerFilter,
): T {
  let q: any = query;
  if (f.category) q = q.eq("category", f.category);
  if (f.min_revenue != null) q = q.gte("est_monthly_revenue", f.min_revenue);
  if (f.max_revenue != null) q = q.lte("est_monthly_revenue", f.max_revenue);
  if (f.min_growth != null) q = q.gte("growth_3mo", f.min_growth);
  if (f.max_asins != null) q = q.lte("num_asins", f.max_asins);
  if (f.matched_only) q = q.eq("enrichment_status", "matched");
  if (f.only_pending_filter) q = q.eq("apollo_filter_status", "pending");
  return q as T;
}

// In-memory chunker for the .in() URL-length workaround. Same pattern we
// used elsewhere when iterating big seller sets.
export function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
