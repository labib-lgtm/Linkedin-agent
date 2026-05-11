"use client";

import type { CSSProperties } from "react";

export type Slide = {
  n: number;
  role: string;
  layout: string;
  headline: string;
  supporting: string | null;
  stat: string | null;
  visual_element: string;
  color_emphasis: string;
  image_gen_prompt: string | null;
};

export type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  paper: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

const ROLE_LABEL: Record<string, string> = {
  cover: "Cover",
  "list-item": "List",
  "framework-block": "Block",
  chart: "Chart",
  quote: "Quote",
  divider: "Divider",
  payoff: "Payoff",
  cta: "CTA",
};

// Map color_emphasis → background + foreground per palette. Inverted
// flips paper/ink so the CTA slide has visual contrast. Primary uses
// the brand primary as background — ink text reads on light primaries
// (e.g. Lynx #C6F21F) and the accent stays available for headline pops.
function emphasisStyle(emphasis: string, p: Palette): CSSProperties {
  switch (emphasis) {
    case "inverted":
      return { background: p.ink, color: p.paper };
    case "primary":
      return { background: p.primary, color: p.ink };
    case "secondary":
      return { background: p.secondary, color: p.paper };
    case "accent":
      return { background: p.accent, color: p.paper };
    case "neutral":
    default:
      return { background: p.paper, color: p.ink };
  }
}

function accentText(emphasis: string, p: Palette): string {
  if (emphasis === "inverted") return p.primary;
  if (emphasis === "primary") return p.ink;
  return p.accent;
}

export function SlideCard({
  slide,
  palette,
  total,
  onClick,
  selected,
  pickedImagePath,
}: {
  slide: Slide;
  palette: Palette;
  total: number;
  onClick?: () => void;
  selected?: boolean;
  pickedImagePath?: string | null;
}) {
  const style = emphasisStyle(slide.color_emphasis, palette);
  const accent = accentText(slide.color_emphasis, palette);
  const isCover = slide.role === "cover";
  const isCta = slide.role === "cta";
  const isListItem = slide.role === "list-item" || slide.layout === "big-number";
  const pickedUrl = publicAssetUrl(pickedImagePath);

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`relative aspect-square rounded-lg overflow-hidden text-left p-0 transition-transform ${
        onClick ? "hover:-translate-y-0.5" : ""
      } ${selected ? "ring-2 ring-lynx-green" : "ring-1 ring-border"}`}
      style={style}
    >
      {pickedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={pickedUrl}
          alt={`Slide ${slide.n} illustration`}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : null}
      {pickedUrl ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              slide.color_emphasis === "inverted"
                ? "linear-gradient(180deg, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.85) 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.9) 100%)",
          }}
        />
      ) : null}
      <span
        className="absolute top-2 left-2 text-[9px] font-bold tracking-[0.08em] opacity-60"
        style={{ color: style.color as string }}
      >
        {String(slide.n).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <span
        className="absolute top-2 right-2 text-[8px] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded"
        style={{ background: style.color as string, color: style.background as string }}
      >
        {ROLE_LABEL[slide.role] ?? slide.role}
      </span>

      <div className="h-full flex flex-col justify-center px-5 py-7">
        {isListItem ? (
          <div
            className="text-[44px] leading-none font-extrabold mb-1"
            style={{ color: accent, fontFamily: "Georgia, serif" }}
          >
            {String(slide.n - 1).padStart(2, "0")}
          </div>
        ) : null}
        <h3
          className={`font-extrabold leading-tight ${
            isCover || isCta ? "text-[18px]" : "text-[14px]"
          }`}
          style={{ fontFamily: "Georgia, serif", letterSpacing: "-0.01em" }}
        >
          {isCover ? renderHookWithAccent(slide.headline, accent) : slide.headline}
        </h3>
        {slide.supporting ? (
          <p
            className="mt-2 text-[11px] leading-snug opacity-80"
            style={{ color: style.color as string }}
          >
            {slide.supporting}
          </p>
        ) : null}
        {slide.stat ? (
          <p
            className="mt-1.5 text-[10px] font-semibold"
            style={{ color: accent }}
          >
            {slide.stat}
          </p>
        ) : null}
        {isCta && slide.image_gen_prompt === null ? (
          <p
            className="mt-3 text-[10px] font-bold tracking-wider"
            style={{ color: accent }}
          >
            ↗
          </p>
        ) : null}
      </div>
      {isCover ? (
        <div
          className="absolute left-5 right-5 bottom-3 h-1 rounded-full"
          style={{ background: `${style.color}22` }}
        >
          <span
            className="block h-1 rounded-full"
            style={{ width: "12%", background: accent }}
          />
        </div>
      ) : null}
    </Wrapper>
  );
}

// Lightweight accent on the strongest 2 words of the cover headline.
// Identifies the first all-caps or numeric run (e.g. "5 mistakes") and
// wraps it in the accent color. Falls back to plain text.
function renderHookWithAccent(text: string, accent: string) {
  const m = text.match(/^(\S+\s+\S+)\s+(.*)$/);
  if (!m) return text;
  return (
    <>
      <span style={{ color: accent }}>{m[1]}</span> {m[2]}
    </>
  );
}
