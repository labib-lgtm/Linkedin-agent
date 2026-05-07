"use client";

import { useState } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

type BodyParagraph = { role: string; text: string };

// Bottom-left FAB. Renders the post as it would look in the LinkedIn
// feed — author, body excerpt, mini carousel strip. Pure presentation
// (no API calls). Helps the operator visualize before publishing.
export function LinkedInPreview({
  authorName,
  authorPicture,
  bodyParagraphs,
  format,
  slideImagePaths,
  totalSlides,
}: {
  authorName: string;
  authorPicture: string | null;
  bodyParagraphs: BodyParagraph[] | null;
  format: string | null;
  slideImagePaths: Record<string, string> | null;
  totalSlides: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const text = (bodyParagraphs ?? []).map((p) => p.text).join("\n\n");
  const initials = authorName
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const slideStrip = format === "carousel" && totalSlides > 0
    ? Array.from({ length: Math.min(5, totalSlides) }, (_, i) => {
        const path = slideImagePaths?.[String(i + 1)] ?? null;
        return publicAssetUrl(path);
      })
    : [];

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-40 px-3 py-2 rounded-full bg-foreground text-background text-xs font-semibold shadow-lg hover:bg-foreground/90"
      >
        ◧ Preview
      </button>
    );
  }

  return (
    <aside className="fixed bottom-4 left-4 z-40 w-[260px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground">
          In feed · preview
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground hover:text-foreground text-base leading-none"
        >
          ×
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          {authorPicture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={authorPicture}
              alt={authorName}
              className="w-6 h-6 rounded-full object-cover"
            />
          ) : (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-lynx-green text-lynx-charcoal text-[9px] font-bold">
              {initials || "?"}
            </span>
          )}
          <span className="text-xs">
            <strong className="text-foreground">{authorName}</strong>
          </span>
        </div>
        <div
          className="text-[11px] leading-relaxed text-foreground whitespace-pre-line max-h-[100px] overflow-hidden"
          style={{
            WebkitMaskImage: "linear-gradient(180deg, #000 70%, transparent 100%)",
            maskImage: "linear-gradient(180deg, #000 70%, transparent 100%)",
          }}
        >
          {text || <span className="text-muted-foreground italic">No body yet — generate copy.</span>}
        </div>
        {slideStrip.length > 0 ? (
          <div className="flex gap-1 h-12">
            {slideStrip.map((url, i) => (
              <div
                key={i}
                className="flex-1 rounded bg-muted overflow-hidden border border-border"
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
