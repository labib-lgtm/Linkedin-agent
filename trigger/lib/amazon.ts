/**
 * Amazon storefront scraper — extracts the brand display name from a
 * seller's Amazon storefront page so we have a precise query to feed
 * into the LinkedIn company search.
 *
 * The problem this solves: CSV seller_name/business_name fields are
 * often generic legal entity names ("Between LLC", "AKS B2C LLC") that
 * LinkedIn's classic search matches against the wrong company. The
 * brand display name on Amazon (e.g. "BTween Girls Apparel") is far
 * more specific and routes to the correct LinkedIn company.
 *
 * Best-effort: returns null on any failure (block, timeout, parse). The
 * caller falls back to seller_name/business_name in that case.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;

/** Strip HTML entities + collapse whitespace. Doesn't try to be a full
 *  HTML entity decoder — just the handful that show up in brand names. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic: reject obviously-junk extractions. Real brand names are
 *  typically 2-80 chars, not just punctuation, not boilerplate. */
function isPlausibleBrand(s: string | null | undefined): s is string {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/^[\s\-_.]+$/.test(t)) return false;
  if (/^amazon\.com$/i.test(t)) return false;
  if (/^seller\s*profile$/i.test(t)) return false;
  if (/^visit the/i.test(t)) return false;
  return true;
}

/** Pull the brand display name out of an Amazon storefront HTML response.
 *  Tries the most-reliable patterns first, falls through on failure. */
function extractBrandFromHtml(html: string): string | null {
  // Pattern 1: "Visit the [BrandName] Store" / "Visit the [BrandName] Storefront"
  // This is the strongest signal — the call-to-action button on a seller
  // profile uses the brand's preferred display name.
  const visitMatch = html.match(/Visit the\s+(.+?)\s+(?:Storefront|Store)/i);
  if (visitMatch) {
    const v = decode(visitMatch[1]);
    if (isPlausibleBrand(v)) return v;
  }

  // Pattern 2: <h1 id="sellerName">BrandName</h1> (older seller-profile layout)
  const sellerNameH1 = html.match(/<h1[^>]*id=["']sellerName["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (sellerNameH1) {
    const v = decode(sellerNameH1[1].replace(/<[^>]+>/g, ""));
    if (isPlausibleBrand(v)) return v;
  }

  // Pattern 3: Page title — Amazon uses several formats; we strip prefixes
  //   "Amazon.com Seller Profile: BrandName"
  //   "Amazon.com: BrandName"
  //   "BrandName - Amazon.com"
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    let t = decode(titleMatch[1]);
    t = t.replace(/^Amazon\.com\s*Seller\s*Profile:\s*/i, "");
    t = t.replace(/^Amazon\.com\s*[:\-]\s*/i, "");
    t = t.replace(/\s*[-:\|]\s*Amazon\.com.*$/i, "");
    t = t.trim();
    if (isPlausibleBrand(t)) return t;
  }

  // Pattern 4: og:site_name meta — set by branded store pages
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSite) {
    const v = decode(ogSite[1]);
    if (isPlausibleBrand(v)) return v;
  }

  // Pattern 5: og:title — set by some store pages
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) {
    const v = decode(ogTitle[1]);
    if (isPlausibleBrand(v)) return v;
  }

  return null;
}

/** Fetch an Amazon storefront/seller-profile URL and return the brand
 *  display name, or null on any failure. The caller is expected to
 *  fall back to seller_name/business_name in that case. */
export async function fetchAmazonBrandName(storefrontUrl: string): Promise<string | null> {
  if (!storefrontUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(storefrontUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return extractBrandFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
