"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { breakoutPosts, colorFor, type AggregatePost } from "@/lib/competitor-aggregate";

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  is_self: boolean;
  recent_posts: AggregatePost[];
};

const FORMAT_LABEL: Record<string, string> = {
  text: "Text",
  carousel: "Carousel",
  image: "Image",
  video: "Video",
  poll: "Poll",
  document: "Document",
  article: "Article",
  gif: "GIF",
  none: "Text",
};

// Posts that scored >= 3x the author's own 90-day median. The strategy
// argument: top-N is the wrong frame because some authors just post viral
// content; the alpha is in posts that surprised even the author. We render
// at most 6 cards so the section stays scannable on a single screen.
export function Breakouts({ rows, limit = 6 }: { rows: Row[]; limit?: number }) {
  const router = useRouter();

  // Stash the full post body so the new-angle form can prefill the hook seed.
  // sessionStorage (not a query param) so arbitrarily long posts carry over
  // without URL-length limits.
  function draftThisStyle(fullText: string) {
    try {
      sessionStorage.setItem("angle_seed", fullText);
    } catch {
      // sessionStorage can throw in private mode; the form just opens blank.
    }
    router.push("/angles/new?seed=1");
  }

  const breakouts = useMemo(() => {
    const byId: Record<string, string> = Object.fromEntries(rows.map((r, i) => [r.id, String(i)]));
    void byId; // index for color lookup mirrored below
    return breakoutPosts(
      rows.map((r) => ({
        id: r.id,
        name: r.display_name || r.identifier,
        posts: r.recent_posts,
      })),
    ).slice(0, limit);
  }, [rows, limit]);

  if (breakouts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No breakouts in the last 28 days. Run Re-analyze on competitors to refresh post data.
      </div>
    );
  }

  // Map competitor id → color index for the author dot.
  const colorByCompetitor: Record<string, string> = {};
  rows.forEach((r, i) => {
    colorByCompetitor[r.id] = r.is_self ? "#0e0e0e" : colorFor(i);
  });

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {breakouts.map((b) => {
        const date = b.posted_at ? new Date(b.posted_at) : null;
        const formatLabel = FORMAT_LABEL[b.media_type ?? "none"] ?? "Text";
        return (
          <div
            key={b.post_id}
            className="rounded-xl border border-border bg-card p-4 flex flex-col hover:border-foreground/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: colorByCompetitor[b.competitor_id] ?? "#888" }}
                />
                <span className="text-xs text-muted-foreground truncate">
                  <strong className="text-foreground font-semibold">{b.competitor_name}</strong>
                  {date ? ` · ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 flex-shrink-0">
                <span className="text-lg font-bold tabular-nums">{b.score.toLocaleString()}</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                  {b.multiplier}×
                </span>
              </div>
            </div>
            <div className="text-sm text-foreground leading-relaxed mb-3 flex-1">
              {b.excerpt}
              {b.excerpt.length === 220 ? "…" : ""}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
                {formatLabel}
              </span>
              <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
                {b.word_count} words
              </span>
            </div>
            <div className="pt-3 border-t border-border flex items-center justify-between text-xs">
              <a
                href={`https://www.linkedin.com/feed/update/${b.post_id}/`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                View on LinkedIn →
              </a>
              <button
                type="button"
                onClick={() => draftThisStyle(b.full_text || b.excerpt)}
                className="font-semibold hover:text-lynx-charcoal"
              >
                Draft this style →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
