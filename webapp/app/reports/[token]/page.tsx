import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ReportPayload = {
  account: { id: string; name: string; brand_color: string | null; logo_url: string | null };
  week_start: string;
  changes: Array<{
    competitor: string;
    kind: string;
    before: string | null;
    after: string | null;
    detected_at: string;
  }>;
  breakouts: Array<{
    competitor_id: string;
    competitor_name: string;
    post_id: string;
    posted_at: string;
    score: number;
    multiplier: number;
    text_excerpt: string;
    media_type: string | null;
  }>;
  hook_recommendations: Array<{ template: string; sample: number; avg_score: number }>;
};

// Public weekly report page. No PIN auth — the 16-char share_token is the
// auth (2^64 keyspace). Lynx generates one of these per account per week
// and copies the link to send to the client.
export default async function WeeklyReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("client_reports")
    .select("payload, generated_at, week_start")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !data) notFound();

  const payload = data.payload as ReportPayload;
  const account = payload.account;
  const generatedAt = new Date(data.generated_at as string);
  const weekStart = new Date(data.week_start as string);

  return (
    <div
      className="min-h-screen p-6 sm:p-10"
      style={{
        background: "#fafaf7",
      }}
    >
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header banner */}
        <div
          className="px-8 py-6 flex items-center justify-between"
          style={{ background: account.brand_color || "#0e0e0e" }}
        >
          <div className="text-white">
            <div className="text-xs uppercase tracking-widest opacity-70">Weekly LinkedIn report</div>
            <h1 className="text-2xl font-bold mt-1 text-white" style={{ color: contrastText(account.brand_color) }}>
              {account.name}
            </h1>
          </div>
          <div className="text-right text-[11px]" style={{ color: contrastText(account.brand_color) }}>
            <div>Week of {weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            <div className="opacity-70">Generated {generatedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
          </div>
        </div>

        {/* Three-column body */}
        <div className="grid gap-8 p-8 lg:grid-cols-3">
          {/* Changes */}
          <Section title="What changed" subtitle="Competitor positioning shifts" empty="No detected changes this week.">
            {payload.changes.length === 0 ? null : payload.changes.map((c, i) => (
              <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-amber-700 font-bold mb-1">
                  {c.competitor} · {c.kind.replace("_", " ")}
                </div>
                {c.before && c.after ? (
                  <div>
                    <div className="text-amber-900 line-through text-[11px] mb-0.5">{truncate(c.before, 80)}</div>
                    <div className="text-amber-900 font-medium">{truncate(c.after, 80)}</div>
                  </div>
                ) : (
                  <div className="text-amber-900">{truncate(c.after ?? "", 100)}</div>
                )}
              </div>
            ))}
          </Section>

          {/* Breakouts */}
          <Section title="Breakouts to study" subtitle="Posts ≥ 3× author median" empty="No breakouts this week.">
            {payload.breakouts.length === 0 ? null : payload.breakouts.map((b) => (
              <div key={b.post_id} className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold">
                    {b.competitor_name}
                  </span>
                  <span className="font-bold text-emerald-900">
                    {b.score.toLocaleString()}{" "}
                    <span className="text-[10px] bg-emerald-700 text-white px-1.5 py-0.5 rounded">
                      {b.multiplier}×
                    </span>
                  </span>
                </div>
                <p className="text-emerald-900 leading-relaxed">{truncate(b.text_excerpt, 180)}</p>
              </div>
            ))}
          </Section>

          {/* Recommended */}
          <Section title="Hooks to test" subtitle="Highest avg engagement" empty="Not enough data yet.">
            {payload.hook_recommendations.length === 0 ? null : payload.hook_recommendations.map((h, i) => (
              <div key={i} className="rounded-lg bg-card border border-border p-3 text-xs">
                <div className="font-mono text-foreground mb-1.5">{h.template}</div>
                <div className="text-[10px] text-muted-foreground">
                  Avg <strong className="text-emerald-700">{h.avg_score.toLocaleString()}</strong> · n={h.sample}
                </div>
              </div>
            ))}
          </Section>
        </div>

        <div className="px-8 py-4 bg-muted/30 border-t border-border text-[11px] text-muted-foreground text-center">
          Generated by Lynx LinkedIn Agent. Share this link freely — no login required.
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: string;
  children: React.ReactNode;
}) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-bold text-base">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {isEmpty ? (
        <p className="text-[11px] text-muted-foreground italic">{empty}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function contrastText(bg: string | null): string {
  if (!bg) return "#fff";
  // Quick relative-luminance check for text contrast.
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return "#fff";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0e0e0e" : "#fff";
}
