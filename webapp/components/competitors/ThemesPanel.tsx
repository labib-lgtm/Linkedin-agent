"use client";

type Theme = {
  id: string;
  name: string;
  llm_summary: string | null;
  post_count: number;
  avg_score: number;
  leader_competitor_id: string | null;
  leader_name: string | null;
};

// Theme cards driven by Phase 4 embedding clustering. Each card shows
// name, post count, avg score, leader competitor (the one with the most
// posts in this cluster). Click → would expand to post examples (TODO).
export function ThemesPanel({ themes }: { themes: Theme[] }) {
  if (themes.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-1">Content themes</h3>
        <p className="text-xs text-muted-foreground">
          No themes yet. The daily-analyze-posts task clusters posts via embedding similarity.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">Content themes</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Topic clusters across the peer set. Leader = competitor with the most posts in the cluster.
      </p>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {themes.slice(0, 6).map((t) => (
          <div
            key={t.id}
            className="rounded-lg border border-border bg-background p-3 hover:border-foreground/30 transition-colors"
          >
            <div className="font-semibold text-xs mb-1 truncate">{t.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {t.post_count} posts · avg{" "}
              <strong className={t.avg_score >= 500 ? "text-emerald-700" : "text-foreground"}>
                {Math.round(Number(t.avg_score)).toLocaleString()}
              </strong>
            </div>
            {t.leader_name ? (
              <div className="text-[11px] text-foreground mt-1">
                Leader: <strong>{t.leader_name}</strong>
              </div>
            ) : null}
            {t.llm_summary ? (
              <div className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2">
                {t.llm_summary}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
