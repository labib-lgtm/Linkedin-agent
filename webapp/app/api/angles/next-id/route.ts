import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// ISO-8601 week number (weeks start Monday; week 1 contains the year's first
// Thursday). Matches the YYYY-WNN-AXX angle-id convention.
function isoYearWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // shift to this week's Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: date.getUTCFullYear(), week };
}

// GET /api/angles/next-id — suggest the next angle id for the current ISO week
// (e.g. 2026-W21-A03), scoped to the active account. Looks at existing ids with
// the same YYYY-WNN- prefix and increments the highest AXX.
export async function GET() {
  const { year, week } = isoYearWeek(new Date());
  const prefix = `${year}-W${String(week).padStart(2, "0")}`;

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  const { data, error } = await supabase
    .from("angles")
    .select("angle_id")
    .eq("account_id", accountId)
    .ilike("angle_id", `${prefix}-A%`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let maxN = 0;
  for (const row of data ?? []) {
    const m = /-A(\d+)$/.exec(String(row.angle_id ?? ""));
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const next_id = `${prefix}-A${String(maxN + 1).padStart(2, "0")}`;
  return NextResponse.json({ next_id, week_assigned: prefix });
}
