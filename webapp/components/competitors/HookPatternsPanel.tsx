"use client";

type HookPattern = {
  id: string;
  template: string;
  normalized_key: string;
  sample_count: number;
  avg_score: number;
};

// Top hook patterns ranked by avg engagement score. Phase 4 LLM-extracted
// (via daily-analyze-posts task). Bar visualizes relative score, n=count
// shows sample size so the operator can judge confidence.
export function HookPatternsPanel({ hooks }: { hooks: HookPattern[] }) {
  if (hooks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-1">Top hook patterns</h3>
        <p className="text-xs text-muted-foreground">
          No patterns yet. Run the daily-analyze-posts task to extract hooks from competitor posts.
        </p>
      </div>
    );
  }
  const max = Math.max(...hooks.map((h) => h.avg_score), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">Top hook patterns</h3>
      <p className="text-xs text-muted-foreground mb-4">
        First-line patterns ranked by avg engagement · n = posts in peer set
      </p>
      <div className="space-y-1">
        {hooks.slice(0, 6).map((h) => {
          const w = max > 0 ? (h.avg_score / max) * 100 : 0;
          return (
            <div
              key={h.id}
              className="grid items-center gap-3 py-2 border-b border-border last:border-b-0"
              style={{ gridTemplateColumns: "1fr 80px 90px" }}
            >
              <span className="font-mono text-xs text-foreground truncate">
                {h.template || h.normalized_key}
              </span>
              <span className="h-1.5 rounded bg-muted overflow-hidden">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${w}%`,
                    background: "linear-gradient(90deg, #b9d92e, #d6f24a)",
                  }}
                />
              </span>
              <span className="text-right tabular-nums text-xs font-semibold">
                {Math.round(h.avg_score).toLocaleString()}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  n={h.sample_count}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
