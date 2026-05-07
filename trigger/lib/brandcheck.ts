/**
 * Deterministic brand-consistency check for generated images.
 *
 * Per the project's roast: "GPT-4o-mini scoring 1-5 on palette match
 * against 5 reference images is a coin flip. Replace with: extract
 * dominant colors from the generated image, compute Euclidean distance
 * in LAB color space against brand palette." That's what this module
 * does — sharp's .stats() gives a single dominant color sample (R/G/B
 * average over the image), we convert palette + dominant to LAB, find
 * the nearest palette key by Delta E, and score 0–100 on that distance.
 *
 * Trade-off: a single dominant color is coarser than k-means top-5,
 * but for the editorial carousel use-case (one strong figure on a
 * neutral background) it's a faithful proxy and runs in ~50 ms.
 */
import sharp from "sharp";

export type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  paper: string;
};

export type BrandScore = {
  brand_score: number;                                     // 0..100
  dominant: { r: number; g: number; b: number };
  closest_palette_key: keyof Palette;
  distance: number;                                        // Delta E approximation
};

/**
 * Score a single image (bytes) against a brand palette.
 * Returns 100 = perfect dominant match, 0 = far from every palette color.
 * Threshold for "good": >= 60 (within ~24 Delta E units of any palette color).
 */
export async function brandConsistencyScore(
  imageBytes: Uint8Array,
  palette: Palette,
): Promise<BrandScore> {
  const stats = await sharp(Buffer.from(imageBytes)).stats();
  const dominant = stats.dominant; // { r, g, b } — average dominant color
  const dom = { r: dominant.r, g: dominant.g, b: dominant.b };

  let closestKey: keyof Palette = "primary";
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const key of Object.keys(palette) as Array<keyof Palette>) {
    const rgb = hexToRgb(palette[key]);
    if (!rgb) continue;
    const dE = deltaE(rgb, dom);
    if (dE < closestDistance) {
      closestDistance = dE;
      closestKey = key;
    }
  }

  // Score: 100 at distance 0, 0 at distance 60+ (Delta E > 60 is noticeably
  // different even to a layperson). Linear interpolation between.
  const score = Math.max(0, Math.min(100, Math.round(100 - (closestDistance / 60) * 100)));

  return {
    brand_score: score,
    dominant: dom,
    closest_palette_key: closestKey,
    distance: Math.round(closestDistance * 10) / 10,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

// Delta E in CIE76 (LAB Euclidean) — coarser than CIEDE2000 but ~10 LOC.
// Good enough for "is the dominant color in the same neighborhood."
function deltaE(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  const dL = la.L - lb.L;
  const dA = la.a - lb.a;
  const dB = la.b - lb.b;
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function rgbToLab(rgb: { r: number; g: number; b: number }): { L: number; a: number; b: number } {
  // sRGB → linear RGB
  const linearize = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);

  // linear RGB → XYZ (D65)
  const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  // XYZ → LAB
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 3132 + 4 / 29);
  const fX = f(X);
  const fY = f(Y);
  const fZ = f(Z);
  return {
    L: 116 * fY - 16,
    a: 500 * (fX - fY),
    b: 200 * (fY - fZ),
  };
}
