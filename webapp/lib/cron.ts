import "server-only";
import { type NextRequest } from "next/server";

// Vercel Cron requests carry an Authorization: Bearer ${CRON_SECRET} header.
// Set CRON_SECRET in Vercel env. Returns true when the request is a valid
// cron invocation, false otherwise — caller should 401 on false.
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}
