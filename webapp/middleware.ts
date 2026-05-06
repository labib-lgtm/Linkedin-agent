import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/lock",
  "/api/auth/unlock",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // Cron routes do their own auth via CRON_SECRET — middleware can't see
  // the Authorization header in a way that survives Vercel's cron invoker.
  if (pathname.startsWith("/api/cron/")) return true;
  if (/\.(svg|png|jpg|jpeg|webp|ico|gif|css|js|map)$/i.test(pathname)) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySession(cookie);
  if (ok) return NextResponse.next();

  // For API requests, return 401 instead of redirecting to a page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/lock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every path except Next internals and static assets. Keeps the
  // matcher list tight; the public-path check above does the fine-grained
  // filtering.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
