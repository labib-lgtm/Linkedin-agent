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

const STATUS_TONE: Record<Prospect["status"], string> = {
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

function formatMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * (n <= 1 && n !== 0 ? 100 : 1)).toFixed(0)}%`;
}

export function ProspectsView() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importFilter, setImportFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
      // Optimistic local update.
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
        <div className="space-y-2">
          {sellers.map((s) => (
            <SellerCard
              key={s.id}
              seller={s}
              expanded={!!expanded[s.id]}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
              }
              onProspectStatus={updateProspectStatus}
            />
          ))}
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

function SellerCard({
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
  const hasProspects = (seller.prospects?.length ?? 0) > 0;
  const tone = ENRICH_TONE[seller.enrichment_status];
  const growthVal = seller.growth_3mo;
  const growthTone =
    growthVal === null
      ? ""
      : growthVal >= 50
        ? "text-green-700"
        : growthVal < 0
          ? "text-rose-700"
          : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">
                {seller.seller_name || seller.business_name || "—"}
              </span>
              {seller.business_name && seller.business_name !== seller.seller_name ? (
                <span className="text-[11px] text-muted-foreground truncate">
                  ({seller.business_name})
                </span>
              ) : null}
              <span
                className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${tone}`}
              >
                {seller.enrichment_status.replace("_", " ")}
              </span>
              {hasProspects ? (
                <span className="text-[10px] font-bold bg-foreground text-background px-1.5 py-0.5 rounded">
                  {seller.prospects.length} prospect{seller.prospects.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {seller.category ? <span>{seller.category}</span> : null}
              {seller.est_monthly_revenue !== null ? (
                <span>· {formatMoney(seller.est_monthly_revenue)}/mo</span>
              ) : null}
              {seller.num_asins !== null ? <span>· {seller.num_asins} ASINs</span> : null}
              {growthVal !== null ? (
                <span className={growthTone}>· {formatPct(growthVal)} 3mo</span>
              ) : null}
              {seller.city && seller.state ? (
                <span>
                  · {seller.city}, {seller.state}
                </span>
              ) : null}
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground self-start sm:self-center">
            {expanded ? "▾" : "▸"}
          </span>
        </button>

        {expanded ? (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            {seller.linkedin_company_url ? (
              <a
                href={seller.linkedin_company_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-700 hover:underline break-all"
              >
                LinkedIn company page → {seller.linkedin_company_url}
              </a>
            ) : null}
            {seller.enrichment_error ? (
              <p className="text-[11px] text-rose-700 break-all">
                Error: {seller.enrichment_error}
              </p>
            ) : null}
            {hasProspects ? (
              <div className="space-y-1.5">
                {seller.prospects.map((p) => (
                  <div
                    key={p.id}
                    className="grid gap-2 sm:gap-3 items-start p-2 rounded border border-border bg-muted/20"
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
                        className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${STATUS_TONE[p.status]}`}
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
        ) : null}
      </CardContent>
    </Card>
  );
}
