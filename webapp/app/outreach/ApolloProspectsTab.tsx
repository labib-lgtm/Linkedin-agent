"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Filter = {
  category: string;
  min_revenue: string;
  max_revenue: string;
  min_growth: string;
  max_growth: string;
  min_asins: string;
  max_asins: string;
  matched_only: boolean;
  exclude_enrolled: boolean;
};

const EMPTY_FILTER: Filter = {
  category: "",
  min_revenue: "",
  max_revenue: "",
  min_growth: "",
  max_growth: "",
  min_asins: "",
  max_asins: "",
  matched_only: true,
  exclude_enrolled: false,
};

const TOP_CATEGORIES = [
  "Health & Household",
  "Beauty & Personal Care",
  "Grocery & Gourmet Food",
  "Sports & Outdoors",
  "Electronics",
  "Clothing, Shoes & Jewelry",
  "Home & Kitchen",
  "Automotive",
  "Patio, Lawn & Garden",
  "Toys & Games",
  "Pet Supplies",
  "Office Products",
  "Tools & Home Improvement",
  "Musical Instruments",
];

type Preview = {
  total: number;
  by_status: Record<string, number>;
  credit_cap_estimate: number;
};

type ProspectRow = {
  id: string;
  seller_id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  linkedin_profile_url: string | null;
  company_linkedin_url: string | null;
  amazon_storefront_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  enriched_at: string;
  seller:
    | {
        brand_name: string | null;
        business_name: string | null;
        category: string | null;
        est_monthly_revenue: number | null;
        growth_3mo: number | null;
        num_asins: number | null;
      }
    | { brand_name: string | null; business_name: string | null; category: string | null; est_monthly_revenue: number | null; growth_3mo: number | null; num_asins: number | null }[]
    | null;
};

function sellerOf(r: ProspectRow) {
  if (!r.seller) return null;
  return Array.isArray(r.seller) ? r.seller[0] ?? null : r.seller;
}

function filterToQuery(f: Filter): URLSearchParams {
  const q = new URLSearchParams();
  if (f.category) q.set("category", f.category);
  if (f.min_revenue) q.set("min_revenue", f.min_revenue);
  if (f.max_revenue) q.set("max_revenue", f.max_revenue);
  if (f.min_growth) q.set("min_growth", f.min_growth);
  if (f.max_growth) q.set("max_growth", f.max_growth);
  if (f.min_asins) q.set("min_asins", f.min_asins);
  if (f.max_asins) q.set("max_asins", f.max_asins);
  if (f.matched_only) q.set("matched_only", "1");
  if (f.exclude_enrolled) q.set("exclude_enrolled", "1");
  return q;
}

export function ApolloProspectsTab() {
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rows, setRows] = useState<ProspectRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [budget, setBudget] = useState(100);
  const [search, setSearch] = useState("");

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/outreach/apollo/preview?${filterToQuery(filter).toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setPreview(data);
    } catch (e) {
      toast.error(`Preview failed: ${(e as Error).message}`);
    } finally {
      setPreviewLoading(false);
    }
  }, [filter]);

  const refreshRows = useCallback(async () => {
    setRowsLoading(true);
    try {
      const q = filterToQuery(filter);
      q.set("limit", "500");
      const res = await fetch(`/api/outreach/apollo/prospects?${q.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.rows ?? []);
      setRowsTotal(data.total ?? 0);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setRowsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refreshPreview();
    void refreshRows();
  }, [refreshPreview, refreshRows]);

  async function enrich() {
    setEnriching(true);
    try {
      const res = await fetch(`/api/outreach/apollo/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter, budget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? data?.message ?? `HTTP ${res.status}`);
      if (data.count === 0) {
        toast.info(data.message ?? "Nothing to enrich.");
      } else {
        toast.success(
          `Enrichment fired on ${data.count} sellers (budget: ${data.estimated_credit_cap} credits). Run: ${data.run_id?.slice(0, 8) ?? "?"}`,
        );
      }
    } catch (e) {
      toast.error(`Enrich failed: ${(e as Error).message}`);
    } finally {
      setEnriching(false);
    }
  }

  function downloadCsv() {
    const q = filterToQuery(filter);
    window.location.href = `/api/outreach/apollo/export.csv?${q.toString()}`;
  }

  const visibleRows = search
    ? rows.filter((r) => {
        const seller = sellerOf(r);
        const blob = (
          (r.name ?? "") +
          " " +
          (r.title ?? "") +
          " " +
          (seller?.brand_name ?? "") +
          " " +
          (seller?.business_name ?? "")
        ).toLowerCase();
        return blob.includes(search.toLowerCase().trim());
      })
    : rows;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filter + enrich</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Category
              </label>
              <select
                value={filter.category}
                onChange={(e) => setFilter({ ...filter, category: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Any</option>
                {TOP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Min revenue / mo
              </label>
              <Input
                type="number"
                placeholder="50000"
                value={filter.min_revenue}
                onChange={(e) => setFilter({ ...filter, min_revenue: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Max revenue / mo
              </label>
              <Input
                type="number"
                placeholder="300000"
                value={filter.max_revenue}
                onChange={(e) => setFilter({ ...filter, max_revenue: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Min 3-month growth %
              </label>
              <Input
                type="number"
                placeholder="50"
                value={filter.min_growth}
                onChange={(e) => setFilter({ ...filter, min_growth: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Max 3-month growth %
              </label>
              <Input
                type="number"
                placeholder="500"
                value={filter.max_growth}
                onChange={(e) => setFilter({ ...filter, max_growth: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Budget (credits)
              </label>
              <Input
                type="number"
                min={1}
                max={500}
                value={budget}
                onChange={(e) => setBudget(Math.max(1, Math.min(500, Number(e.target.value) || 100)))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Min ASIN count
              </label>
              <Input
                type="number"
                placeholder="5"
                value={filter.min_asins}
                onChange={(e) => setFilter({ ...filter, min_asins: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Max ASIN count
              </label>
              <Input
                type="number"
                placeholder="50"
                value={filter.max_asins}
                onChange={(e) => setFilter({ ...filter, max_asins: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            {/* Spacer to keep the 3-col grid clean on the last row */}
            <div className="hidden sm:block" />
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filter.matched_only}
                onChange={(e) => setFilter({ ...filter, matched_only: e.target.checked })}
              />
              Only Sales-Nav-matched sellers
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filter.exclude_enrolled}
                onChange={(e) => setFilter({ ...filter, exclude_enrolled: e.target.checked })}
              />
              Exclude already enrolled in LinkedIn loop
            </label>
            <button
              type="button"
              onClick={() => setFilter(EMPTY_FILTER)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Reset filters
            </button>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            {previewLoading ? (
              <p className="text-muted-foreground">Loading preview…</p>
            ) : preview ? (
              <>
                <p>
                  <span className="font-semibold tabular-nums">{preview.total}</span> sellers match
                  this filter.
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold">{preview.by_status.enriched ?? 0}</span> already
                  enriched ·{" "}
                  <span className="font-semibold">{preview.by_status.has_employees ?? 0}</span>{" "}
                  has-employees (awaiting credit) ·{" "}
                  <span className="font-semibold">{preview.by_status.pending ?? 0}</span> pending
                  pre-filter ·{" "}
                  <span className="font-semibold">
                    {(preview.by_status.no_employees ?? 0) + (preview.by_status.no_org_match ?? 0)}
                  </span>{" "}
                  confirmed dead-end ·{" "}
                  <span className="font-semibold">{preview.by_status.failed ?? 0}</span> failed
                </p>
                <p className="text-xs text-muted-foreground">
                  Running Enrich now would spend up to{" "}
                  <span className="font-semibold">
                    {Math.min(budget, preview.credit_cap_estimate)}
                  </span>{" "}
                  credits.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No preview yet.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="accent"
              onClick={enrich}
              disabled={enriching || !preview || preview.credit_cap_estimate === 0}
            >
              {enriching ? "Triggering…" : "Enrich sellers"}
            </Button>
            <Button type="button" variant="outline" onClick={downloadCsv}>
              Export Meta CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void refreshPreview();
                void refreshRows();
              }}
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Enriched prospects ({rowsTotal})</CardTitle>
            <Input
              type="text"
              placeholder="Search name, brand, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm w-64"
            />
          </div>
        </CardHeader>
        <CardContent>
          {rowsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No enriched prospects yet for this filter. Apply a filter, click Enrich, and the
              worker will populate this table as it runs.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Prospect</th>
                    <th className="py-2 px-3 font-semibold">Title</th>
                    <th className="py-2 px-3 font-semibold">Email</th>
                    <th className="py-2 px-3 font-semibold">Phone</th>
                    <th className="py-2 px-3 font-semibold">Brand</th>
                    <th className="py-2 px-3 font-semibold">Links</th>
                    <th className="py-2 px-3 font-semibold text-right">Rev / Growth</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const s = sellerOf(r);
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                        <td className="py-2 px-3">
                          <div className="font-medium">{r.name ?? "—"}</div>
                          {r.linkedin_profile_url ? (
                            <a
                              href={r.linkedin_profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-700 hover:underline"
                            >
                              LinkedIn profile
                            </a>
                          ) : null}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{r.title ?? "—"}</td>
                        <td className="py-2 px-3 font-mono text-xs">
                          {r.email ? (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(r.email!);
                                toast.success("Email copied");
                              }}
                              className="hover:underline"
                              title="Click to copy"
                            >
                              {r.email}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-xs">
                          {r.phone ? (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(r.phone!);
                                toast.success("Phone copied");
                              }}
                              className="hover:underline"
                              title="Click to copy"
                            >
                              {r.phone}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-medium">{s?.brand_name ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {s?.category ?? ""}
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex flex-col gap-0.5">
                            {r.company_linkedin_url ? (
                              <a
                                href={r.company_linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-blue-700 hover:underline"
                              >
                                Company LinkedIn
                              </a>
                            ) : null}
                            {r.amazon_storefront_url ? (
                              <a
                                href={r.amazon_storefront_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-blue-700 hover:underline"
                              >
                                Amazon storefront
                              </a>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {s?.est_monthly_revenue
                            ? "$" + Math.round(s.est_monthly_revenue / 1000) + "K"
                            : "—"}
                          <div className="text-[10px] text-muted-foreground">
                            {s?.growth_3mo != null ? `+${Math.round(s.growth_3mo)}%` : ""}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
