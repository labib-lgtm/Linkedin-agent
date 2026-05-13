"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImportDialog } from "./ImportDialog";

type Prospect = {
  id: string;
  name: string | null;
  headline: string | null;
  linkedin_url: string | null;
  provider_id: string | null;
  status: "new" | "contacted" | "responded" | "converted" | "archived";
  notes: string | null;
  created_at: string;
};

type Seller = {
  id: string;
  import_id: string;
  seller_name: string | null;
  business_name: string | null;
  category: string | null;
  primary_subcategory: string | null;
  est_monthly_revenue: number | null;
  avg_price: number | null;
  percent_fba: number | null;
  num_asins: number | null;
  num_brands: number | null;
  growth_3mo: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  storefront_url: string | null;
  linkedin_company_urn: string | null;
  linkedin_company_url: string | null;
  enrichment_status: "pending" | "matched" | "no_match" | "failed";
  enrichment_error: string | null;
  enriched_at: string | null;
  created_at: string;
  prospects: Prospect[];
};

type ImportRow = {
  id: string;
  filename: string;
  row_count: number;
  enriched_count: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  created_at: string;
  completed_at: string | null;
};

const PROSPECT_STATUS_TONE: Record<Prospect["status"], string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-amber-100 text-amber-800",
  responded: "bg-violet-100 text-violet-800",
  converted: "bg-green-100 text-green-800",
  archived: "bg-stone-100 text-stone-600",
};

const ENRICH_TONE: Record<Seller["enrichment_status"], string> = {
  pending: "bg-stone-100 text-stone-700",
  matched: "bg-green-100 text-green-800",
  no_match: "bg-amber-50 text-amber-700",
  failed: "bg-rose-100 text-rose-800",
};

type SortKey = "seller" | "revenue" | "asins" | "growth" | "status";

function formatMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  // The CSV gives growth as a percentage already (e.g. 250 means +250%),
  // not a 0-1 ratio. Format with sign.
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
}

export function ProspectsView() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importFilter, setImportFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>("seller");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (importFilter) params.set("import_id", importFilter);
      if (statusFilter) params.set("status", statusFilter);
      const [sellersRes, importsRes] = await Promise.all([
        fetch(`/api/prospects?${params.toString()}`),
        fetch("/api/prospects/imports"),
      ]);
      const sellersData = (await sellersRes.json()) as { sellers?: Seller[] };
      const importsData = (await importsRes.json()) as { imports?: ImportRow[] };
      setSellers(sellersData.sellers ?? []);
      setImports(importsData.imports ?? []);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [importFilter, statusFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh while any import is still processing.
  useEffect(() => {
    const hasActive = imports.some(
      (i) => i.status === "queued" || i.status === "processing",
    );
    if (!hasActive) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [imports, refresh]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of sellers) if (s.category) set.add(s.category);
    return Array.from(set).sort();
  }, [sellers]);

  const counts = useMemo(() => {
    const c = { matched: 0, no_match: 0, failed: 0, pending: 0, with_prospects: 0 };
    for (const s of sellers) {
      c[s.enrichment_status] += 1;
      if ((s.prospects?.length ?? 0) > 0) c.with_prospects += 1;
    }
    return c;
  }, [sellers]);

  const sorted = useMemo(() => {
    const copy = [...sellers];
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortBy) {
        case "seller":
          av = (a.seller_name ?? a.business_name ?? "").toLowerCase();
          bv = (b.seller_name ?? b.business_name ?? "").toLowerCase();
          break;
        case "revenue":
          av = a.est_monthly_revenue;
          bv = b.est_monthly_revenue;
          break;
        case "asins":
          av = a.num_asins;
          bv = b.num_asins;
          break;
        case "growth":
          av = a.growth_3mo;
          bv = b.growth_3mo;
          break;
        case "status":
          av = a.enrichment_status;
          bv = b.enrichment_status;
          break;
      }
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return copy;
  }, [sellers, sortBy, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "seller" ? "asc" : "desc");
    }
  }

  async function updateProspectStatus(p: Prospect, status: Prospect["status"]) {
    try {
      const res = await fetch(`/api/prospects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      setSellers((prev) =>
        prev.map((s) => ({
          ...s,
          prospects: s.prospects.map((x) => (x.id === p.id ? { ...x, status } : x)),
        })),
      );
      toast.success(`Status: ${status}`);
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={importFilter}
            onChange={(e) => setImportFilter(e.target.value)}
            className="text-sm bg-background border border-border rounded px-2 py-1.5"
          >
            <option value="">All imports</option>
            {imports.map((i) => (
              <option key={i.id} value={i.id}>
                {i.filename} · {i.row_count} rows · {i.status}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm bg-background border border-border rounded px-2 py-1.5"
          >
            <option value="">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="responded">Responded</option>
            <option value="converted">Converted</option>
            <option value="archived">Archived</option>
          </select>
          {categories.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {categories.length} categories in view
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
        >
          + Import sellers
        </Button>
      </div>

      {/* Status strip */}
      {sellers.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Pill tone="bg-green-100 text-green-800">{counts.matched} matched</Pill>
          <Pill tone="bg-blue-100 text-blue-800">{counts.with_prospects} with prospects</Pill>
          <Pill tone="bg-amber-50 text-amber-700">{counts.no_match} no match</Pill>
          {counts.failed > 0 ? (
            <Pill tone="bg-rose-100 text-rose-800">{counts.failed} failed</Pill>
          ) : null}
          {counts.pending > 0 ? (
            <Pill tone="bg-stone-100 text-stone-700">{counts.pending} pending</Pill>
          ) : null}
        </div>
      ) : null}

      {loading && sellers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sellers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <p className="text-sm font-medium">No sellers yet.</p>
            <p className="text-xs text-muted-foreground">
              Click <strong>+ Import sellers</strong> to upload an Amazon seller CSV.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 border border-border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8"></th>
                <SortableTh
                  label="Seller"
                  active={sortBy === "seller"}
                  dir={sortDir}
                  onClick={() => toggleSort("seller")}
                />
                <SortableTh
                  label="Status"
                  active={sortBy === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                />
                <th className="px-3 py-2 font-semibold">Category</th>
                <SortableTh
                  label="Revenue"
                  active={sortBy === "revenue"}
                  dir={sortDir}
                  onClick={() => toggleSort("revenue")}
                  right
                />
                <SortableTh
                  label="ASINs"
                  active={sortBy === "asins"}
                  dir={sortDir}
                  onClick={() => toggleSort("asins")}
                  right
                />
                <SortableTh
                  label="3mo"
                  active={sortBy === "growth"}
                  dir={sortDir}
                  onClick={() => toggleSort("growth")}
                  right
                />
                <th className="px-3 py-2 font-semibold hidden lg:table-cell">Location</th>
                <th className="px-3 py-2 font-semibold text-center">Prospects</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <SellerRow
                  key={s.id}
                  seller={s}
                  expanded={!!expanded[s.id]}
                  onToggle={() =>
                    setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                  }
                  onProspectStatus={updateProspectStatus}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDone={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded font-medium ${tone}`}>
      {children}
    </span>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  right,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  right?: boolean;
}) {
  return (
    <th className={`px-3 py-2 font-semibold ${right ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
      >
        <span>{label}</span>
        {active ? (
          <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>
        ) : null}
      </button>
    </th>
  );
}

function SellerRow({
  seller,
  expanded,
  onToggle,
  onProspectStatus,
}: {
  seller: Seller;
  expanded: boolean;
  onToggle: () => void;
  onProspectStatus: (p: Prospect, status: Prospect["status"]) => void;
}) {
  const tone = ENRICH_TONE[seller.enrichment_status];
  const growthVal = seller.growth_3mo;
  const growthTone =
    growthVal === null
      ? ""
      : growthVal >= 50
        ? "text-green-700 font-semibold"
        : growthVal < 0
          ? "text-rose-700"
          : "text-muted-foreground";
  const hasProspects = (seller.prospects?.length ?? 0) > 0;

  return (
    <>
      <tr
        className="border-t border-border hover:bg-muted/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-2 py-2 text-center text-muted-foreground">
          {expanded ? "▾" : "▸"}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">
            {seller.seller_name || seller.business_name || "—"}
          </div>
          {seller.business_name && seller.business_name !== seller.seller_name ? (
            <div className="text-[11px] text-muted-foreground">{seller.business_name}</div>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <span
            className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${tone}`}
          >
            {seller.enrichment_status.replace("_", " ")}
          </span>
        </td>
        <td className="px-3 py-2 text-muted-foreground text-[12px]">
          {seller.category ?? "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {formatMoney(seller.est_monthly_revenue)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {seller.num_asins ?? "—"}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${growthTone}`}>
          {formatPct(growthVal)}
        </td>
        <td className="px-3 py-2 text-muted-foreground text-[12px] hidden lg:table-cell">
          {seller.city && seller.state ? `${seller.city}, ${seller.state}` : "—"}
        </td>
        <td className="px-3 py-2 text-center">
          {hasProspects ? (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-foreground text-background">
              {seller.prospects.length}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-border bg-muted/20">
          <td></td>
          <td colSpan={8} className="px-3 py-3">
            <ExpandedDetail seller={seller} onProspectStatus={onProspectStatus} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExpandedDetail({
  seller,
  onProspectStatus,
}: {
  seller: Seller;
  onProspectStatus: (p: Prospect, status: Prospect["status"]) => void;
}) {
  return (
    <div className="space-y-2">
      {seller.linkedin_company_url ? (
        <a
          href={seller.linkedin_company_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] text-blue-700 hover:underline break-all"
        >
          → LinkedIn company page
        </a>
      ) : null}
      {seller.storefront_url ? (
        <div>
          <a
            href={seller.storefront_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-700 hover:underline break-all"
          >
            → Amazon storefront
          </a>
        </div>
      ) : null}
      {seller.enrichment_error ? (
        <p className="text-[11px] text-rose-700 break-all">
          Error: {seller.enrichment_error}
        </p>
      ) : null}
      {(seller.prospects?.length ?? 0) > 0 ? (
        <div className="space-y-1.5 pt-1">
          {seller.prospects.map((p) => (
            <div
              key={p.id}
              className="grid gap-2 sm:gap-3 items-start p-2 rounded border border-border bg-background"
              style={{ gridTemplateColumns: "1fr auto" }}
            >
              <div className="min-w-0">
                <div className="font-medium text-sm">{p.name ?? "—"}</div>
                {p.headline ? (
                  <div className="text-[11px] text-muted-foreground line-clamp-2">
                    {p.headline}
                  </div>
                ) : null}
                {p.linkedin_url ? (
                  <a
                    href={p.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-700 hover:underline break-all"
                  >
                    {p.linkedin_url}
                  </a>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${PROSPECT_STATUS_TONE[p.status]}`}
                >
                  {p.status}
                </span>
                <select
                  value={p.status}
                  onChange={(e) =>
                    onProspectStatus(p, e.target.value as Prospect["status"])
                  }
                  className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5"
                >
                  <option value="new">new</option>
                  <option value="contacted">contacted</option>
                  <option value="responded">responded</option>
                  <option value="converted">converted</option>
                  <option value="archived">archived</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">
          No prospects matched.
          {seller.linkedin_company_url
            ? " Open the company page to find people manually."
            : ""}
        </p>
      )}
    </div>
  );
}
