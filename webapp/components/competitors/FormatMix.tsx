"use client";

import { formatMixPct, type AggregatePost, type MediaType } from "@/lib/competitor-aggregate";

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  is_self: boolean;
  recent_posts: AggregatePost[];
};

// Stacked horizontal bars showing % share by media_type per competitor + self.
// Surfaces format strategy at a glance — useful to see when self leans
// heavily on text-only while peers post mostly carousels/video.
const FORMAT_ORDER: { key: MediaType; label: string; color: string }[] = [
  { key: "text", label: "Text", color: "#1e293b" },
  { key: "carousel", label: "Carousel", color: "#7c3aed" },
  { key: "image", label: "Image", color: "#0ea5e9" },
  { key: "video", label: "Video", color: "#0891b2" },
  { key: "poll", label: "Poll", color: "#ea580c" },
  { key: "document", label: "Document", color: "#84cc16" },
  { key: "article", label: "Article", color: "#dc2626" },
  { key: "gif", label: "GIF", color: "#ec4899" },
];

export function FormatMix({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Format mix</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          % of posts by content type. Compare your mix to what peers are leaning on.
        </p>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const pct = formatMixPct(r.recent_posts);
          const total = r.recent_posts.length;
          return (
            <div
              key={r.id}
              className={`grid items-center gap-3 px-1.5 py-1 rounded-md ${
                r.is_self ? "bg-lynx-green/5" : ""
              }`}
              style={{ gridTemplateColumns: "120px 1fr" }}
            >
              <span
                className={`text-xs truncate ${r.is_self ? "font-semibold" : "text-muted-foreground"}`}
                title={r.display_name || r.identifier}
              >
                {r.display_name || r.identifier}
              </span>
              {total === 0 ? (
                <div className="h-[18px] bg-muted rounded flex items-center justify-center text-[10px] text-muted-foreground">
                  no recent posts
                </div>
              ) : (
                <div className="flex h-[18px] rounded overflow-hidden bg-muted">
                  {FORMAT_ORDER.map((f) => {
                    const w = pct[f.key] ?? 0;
                    if (w <= 0) return null;
                    return (
                      <div
                        key={f.key}
                        className="h-full"
                        style={{ background: f.color, width: `${w}%` }}
                        title={`${f.label} ${w}%`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
        {FORMAT_ORDER.slice(0, 5).map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-[2px]"
              style={{ background: f.color }}
            />
            {f.label}
          </span>
        ))}
      </div>
    </div>
  );
}
