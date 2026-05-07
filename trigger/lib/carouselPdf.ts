/**
 * Carousel PDF renderer using @react-pdf/renderer.
 *
 * Per the project roast: chose @react-pdf over puppeteer + chromium-min
 * to keep cold-start fast (10x) and avoid native deps that are finicky
 * inside Trigger.dev's runtime. Trade-off: slide layouts re-implemented
 * in PDF primitives (Text + View) rather than reusing the React/CSS
 * SlideCard component verbatim. ~150 LOC for the layout — acceptable
 * cost for the runtime simplicity.
 *
 * Output: one PDF document, one 1080x1080 page per slide. The picked
 * illustration (from angles.slide_image_paths) layers behind the
 * headline + supporting + stat with a translucent gradient overlay
 * matching the studio's web rendering.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export type Slide = {
  n: number;
  role: string;
  layout: string;
  headline: string;
  supporting: string | null;
  stat: string | null;
  visual_element: string;
  color_emphasis: string;
};

export type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  paper: string;
};

const SLIDE_PT = 1080;

function emphasisColors(emphasis: string, p: Palette): { bg: string; fg: string; accentFg: string } {
  switch (emphasis) {
    case "inverted":
      return { bg: p.ink, fg: p.paper, accentFg: p.primary };
    case "secondary":
      return { bg: p.secondary, fg: p.paper, accentFg: p.accent };
    case "accent":
      return { bg: p.accent, fg: p.paper, accentFg: p.paper };
    case "primary":
    case "neutral":
    default:
      return { bg: p.paper, fg: p.ink, accentFg: p.accent };
  }
}

export async function renderCarouselPdf(
  slides: Slide[],
  palette: Palette,
  pickedImageUrls: Record<string, string>,
): Promise<Buffer> {
  const doc = React.createElement(
    Document,
    null,
    slides.map((s) => {
      const colors = emphasisColors(s.color_emphasis, palette);
      const pickedUrl = pickedImageUrls[String(s.n)] ?? null;
      const isCover = s.role === "cover";
      const isCta = s.role === "cta";
      const isListItem = s.role === "list-item" || s.layout === "big-number";
      const styles = pageStyles(colors);
      return React.createElement(
        Page,
        {
          key: s.n,
          size: { width: SLIDE_PT, height: SLIDE_PT },
          style: styles.page,
        },
        // Background image (if picked)
        pickedUrl
          ? React.createElement(Image, {
              key: "bg",
              src: pickedUrl,
              style: styles.bgImage,
            })
          : null,
        // Translucent overlay so headline stays readable on top of the image.
        pickedUrl
          ? React.createElement(View, {
              key: "overlay",
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: colors.bg,
                opacity: 0.6,
              },
            })
          : null,
        // Slide number (top-left)
        React.createElement(
          Text,
          { style: styles.slideNum },
          `${String(s.n).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`,
        ),
        // Role badge (top-right)
        React.createElement(
          View,
          { style: styles.rolePill },
          React.createElement(Text, { style: styles.rolePillText }, s.role.toUpperCase()),
        ),
        // Content stack
        React.createElement(
          View,
          { style: styles.content },
          isListItem
            ? React.createElement(
                Text,
                { style: styles.bigNumber },
                String(s.n - 1).padStart(2, "0"),
              )
            : null,
          React.createElement(
            Text,
            { style: isCover || isCta ? styles.headlineLarge : styles.headlineSmall },
            s.headline,
          ),
          s.supporting
            ? React.createElement(Text, { style: styles.supporting }, s.supporting)
            : null,
          s.stat ? React.createElement(Text, { style: styles.stat }, s.stat) : null,
        ),
      );
    }),
  );
  return await renderToBuffer(doc);
}

function pageStyles(colors: { bg: string; fg: string; accentFg: string }) {
  return StyleSheet.create({
    page: {
      backgroundColor: colors.bg,
      color: colors.fg,
      padding: 80,
      flexDirection: "column",
      justifyContent: "center",
    },
    bgImage: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: SLIDE_PT,
      height: SLIDE_PT,
      objectFit: "cover",
    },
    slideNum: {
      position: "absolute",
      top: 40,
      left: 40,
      fontSize: 14,
      fontWeight: 700,
      color: colors.fg,
      opacity: 0.6,
      letterSpacing: 1.5,
    },
    rolePill: {
      position: "absolute",
      top: 40,
      right: 40,
      backgroundColor: colors.fg,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 4,
    },
    rolePillText: {
      fontSize: 12,
      fontWeight: 700,
      color: colors.bg,
      letterSpacing: 2,
    },
    content: {
      flexDirection: "column",
      gap: 16,
    },
    bigNumber: {
      fontSize: 220,
      fontWeight: 900,
      color: colors.accentFg,
      lineHeight: 1,
      marginBottom: 12,
    },
    headlineLarge: {
      fontSize: 78,
      fontWeight: 800,
      lineHeight: 1.1,
      color: colors.fg,
      letterSpacing: -1,
    },
    headlineSmall: {
      fontSize: 56,
      fontWeight: 800,
      lineHeight: 1.15,
      color: colors.fg,
      letterSpacing: -0.5,
    },
    supporting: {
      fontSize: 26,
      lineHeight: 1.45,
      color: colors.fg,
      opacity: 0.8,
      marginTop: 8,
    },
    stat: {
      fontSize: 22,
      fontWeight: 700,
      color: colors.accentFg,
      marginTop: 6,
    },
  });
}
