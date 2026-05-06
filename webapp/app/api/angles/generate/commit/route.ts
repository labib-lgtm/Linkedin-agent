import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PILLAR_VALUES, FORMAT_VALUES } from "@/lib/constants";
import { getActiveAccountId } from "@/lib/active-account";

type CommitItem = {
  angle_id?: string;
  hook_seed?: string;
  cta_keyword?: string;
  gap_filled?: string;
  pillar?: string;
  format?: string;
};

function newAngleId(): string {
  // 8-char base36 ID. Matches the convention seen in the existing angles
  // table, distinct from UUIDs which the table doesn't use as PK.
  return Math.random().toString(36).slice(2, 10);
}

export async function POST(req: NextRequest) {
  let body: { items?: CommitItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "no_items" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const rows = items.map((item) => ({
    account_id: accountId,
    angle_id: (item.angle_id && item.angle_id.trim()) || newAngleId(),
    status: "Pending" as const,
    pillar: PILLAR_VALUES.includes(item.pillar as never) ? item.pillar : null,
    format: FORMAT_VALUES.includes(item.format as never) ? item.format : null,
    hook_seed: item.hook_seed?.trim() || null,
    cta_keyword: item.cta_keyword?.trim().toUpperCase() || null,
    gap_filled: item.gap_filled?.trim() || null,
    date_generated: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("angles")
    .insert(rows)
    .select("angle_id, status, pillar, format, hook_seed, cta_keyword");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data ?? [] });
}
