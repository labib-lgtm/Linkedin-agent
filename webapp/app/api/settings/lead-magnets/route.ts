import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/settings/lead-magnets — list non-archived magnets for the active account.
export async function GET() {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("lead_magnets")
    .select("*")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ magnets: data ?? [] });
}

// POST /api/settings/lead-magnets — create. Body:
//   { label, kind: 'link'|'file', url, file_path?, description? }
export async function POST(req: NextRequest) {
  let body: {
    label?: string;
    kind?: string;
    url?: string;
    file_path?: string | null;
    description?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const label = String(body.label ?? "").trim();
  const kind = String(body.kind ?? "").trim();
  const url = String(body.url ?? "").trim();

  if (!label) return NextResponse.json({ error: "label_required" }, { status: 400 });
  if (kind !== "link" && kind !== "file") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "url_required" }, { status: 400 });
  if (kind === "file" && !body.file_path) {
    return NextResponse.json({ error: "file_path_required_for_file_kind" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("lead_magnets")
    .insert({
      account_id: accountId,
      label,
      kind,
      url,
      file_path: kind === "file" ? body.file_path : null,
      description: body.description?.trim() || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ magnet: data });
}
