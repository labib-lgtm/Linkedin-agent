import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { AccountSwitchLink } from "./AccountSwitchLink";

export const dynamic = "force-dynamic";

type Account = {
  id: string;
  name: string;
  identifier: string | null;
  brand_color: string | null;
  logo_url: string | null;
  niche_tag: string | null;
  archived_at: string | null;
  created_at: string;
};

type CompetitorRow = {
  account_id: string;
  last_analyzed_at: string | null;
};

type PostRow = {
  account_id: string;
  posted_at: string | null;
  engagement_score: number | string | null;
};

// Book of Business — every account at a glance.
//
// For each account: avatar, niche tag, status pill (▲/●/▼ on 14d engagement
// trend), top event this week (placeholder until Phase 3 surfaces real
// change events), recommended action (placeholder until Phase 4 generates
// LLM recommendations).
//
// Click row → switches active account + redirects to /competitors.
export default async function BookPage() {
  const supabase = createServiceClient();

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    return (
      <div className="container-tight py-8">
        <h1 className="font-heading text-2xl font-bold">Book of Business</h1>
        <p className="mt-4 text-sm text-red-700">Failed to load accounts: {error.message}</p>
      </div>
    );
  }

  const accountIds = (accounts ?? []).map((a: Account) => a.id);
  const summary: Record<
    string,
    {
      competitor_count: number;
      analyzed_recently: number;
      avg_score_recent: number;
      avg_score_prior: number;
      post_count_7d: number;
    }
  > = {};
  if (accountIds.length > 0) {
    const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: comps }, { data: posts }] = await Promise.all([
      supabase
        .from("competitors")
        .select("account_id, last_analyzed_at")
        .in("account_id", accountIds),
      supabase
        .from("competitor_posts")
        .select("account_id, posted_at, engagement_score")
        .in("account_id", accountIds)
        .gte("posted_at", since14),
    ]);
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    for (const c of (comps ?? []) as CompetitorRow[]) {
      const id = c.account_id;
      summary[id] = summary[id] ?? {
        competitor_count: 0, analyzed_recently: 0, avg_score_recent: 0,
        avg_score_prior: 0, post_count_7d: 0,
      };
      summary[id].competitor_count += 1;
      if (
        c.last_analyzed_at &&
        Date.now() - new Date(c.last_analyzed_at).getTime() < SIX_HOURS
      ) {
        summary[id].analyzed_recently += 1;
      }
    }
    const recentSum: Record<string, { sum: number; count: number }> = {};
    const priorSum: Record<string, { sum: number; count: number }> = {};
    for (const p of (posts ?? []) as PostRow[]) {
      const id = p.account_id;
      const score = Number(p.engagement_score ?? 0) || 0;
      if (p.posted_at && p.posted_at >= since7) {
        summary[id] = summary[id] ?? {
          competitor_count: 0, analyzed_recently: 0, avg_score_recent: 0,
          avg_score_prior: 0, post_count_7d: 0,
        };
        summary[id].post_count_7d += 1;
        const r = recentSum[id] ?? { sum: 0, count: 0 };
        r.sum += score;
        r.count += 1;
        recentSum[id] = r;
      } else {
        const r = priorSum[id] ?? { sum: 0, count: 0 };
        r.sum += score;
        r.count += 1;
        priorSum[id] = r;
      }
    }
    for (const id of Object.keys(summary)) {
      summary[id].avg_score_recent =
        recentSum[id]?.count ? recentSum[id].sum / recentSum[id].count : 0;
      summary[id].avg_score_prior =
        priorSum[id]?.count ? priorSum[id].sum / priorSum[id].count : 0;
    }
  }

  function statusPill(s: typeof summary[string] | undefined): { tone: string; label: string; symbol: string } {
    if (!s || s.avg_score_prior === 0) {
      return { tone: "bg-gray-100 text-gray-600", label: "still learning", symbol: "●" };
    }
    const ratio = s.avg_score_recent / s.avg_score_prior;
    if (ratio >= 1.15) return { tone: "bg-emerald-50 text-emerald-700", label: "growing", symbol: "▲" };
    if (ratio <= 0.85) return { tone: "bg-rose-50 text-rose-700", label: "declining", symbol: "▼" };
    return { tone: "bg-gray-100 text-gray-700", label: "steady", symbol: "●" };
  }

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Book of Business
          </h1>
          <p className="text-xs text-muted-foreground">
            All accounts Lynx is managing. Click a row to switch context.
          </p>
        </div>
        <Link
          href="/settings?tab=accounts"
          className="text-sm font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted"
        >
          + Add account
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-3 px-4">Account</th>
              <th className="py-3 px-4">Niche</th>
              <th className="py-3 px-4">Competitors</th>
              <th className="py-3 px-4">Posts (7d)</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Recommended</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 px-4 text-center text-sm text-muted-foreground">
                  No accounts yet. Add one in Settings → Accounts.
                </td>
              </tr>
            ) : null}
            {(accounts ?? []).map((a: Account) => {
              const s = summary[a.id];
              const pill = statusPill(s);
              const initials = (a.name || "?").slice(0, 2).toUpperCase();
              return (
                <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                  <td className="py-3 px-4">
                    <AccountSwitchLink accountId={a.id}>
                      <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold text-white"
                        style={{ background: a.brand_color || "#0e0e0e" }}
                      >
                        {initials}
                      </span>
                      <div>
                        <div className="font-semibold">{a.name}</div>
                        {a.identifier ? (
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {a.identifier}
                          </div>
                        ) : null}
                      </div>
                    </AccountSwitchLink>
                  </td>
                  <td className="py-3 px-4">
                    {a.niche_tag ? (
                      <span className="inline-block text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
                        {a.niche_tag}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {s?.competitor_count ?? 0}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({s?.analyzed_recently ?? 0} fresh)
                    </span>
                  </td>
                  <td className="py-3 px-4 tabular-nums">{s?.post_count_7d ?? 0}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-semibold ${pill.tone}`}>
                      {pill.symbol} {pill.label}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">
                    {(s?.competitor_count ?? 0) === 0
                      ? "Add a competitor to start tracking."
                      : (s?.post_count_7d ?? 0) === 0
                        ? "Re-analyze stale competitors."
                        : "Open Compare to spot breakouts this week."}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Status uses the last 14 days of competitor engagement: ▲ growing = recent avg ≥1.15× prior 7d
        avg, ▼ declining = ≤0.85×, ● otherwise. Phase 3 will fold in profile change events.{" "}
        <Link href="/methodology" className="underline hover:text-foreground">
          Methodology
        </Link>
        .
      </p>
    </div>
  );
}
