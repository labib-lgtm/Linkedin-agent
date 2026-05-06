import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  identifierFromProfileUrl,
  resolveProviderId,
  UnipileError,
} from "@/lib/unipile";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// GET /api/accounts — list non-archived accounts with summary stats.
export async function GET() {
  const supabase = createServiceClient();
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Summary: per-account post counts in last 7d + last analyzed.
  const ids = (accounts ?? []).map((a) => a.id);
  const stats: Record<string, { competitor_count: number; recent_post_count: number }> = {};
  if (ids.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: comps }, { data: posts }] = await Promise.all([
      supabase.from("competitors").select("account_id").in("account_id", ids),
      supabase
        .from("competitor_posts")
        .select("account_id")
        .in("account_id", ids)
        .gte("posted_at", sevenDaysAgo),
    ]);
    for (const row of comps ?? []) {
      const id = row.account_id as string;
      stats[id] = stats[id] ?? { competitor_count: 0, recent_post_count: 0 };
      stats[id].competitor_count += 1;
    }
    for (const row of posts ?? []) {
      const id = row.account_id as string;
      stats[id] = stats[id] ?? { competitor_count: 0, recent_post_count: 0 };
      stats[id].recent_post_count += 1;
    }
  }

  return NextResponse.json({
    accounts: (accounts ?? []).map((a) => ({
      ...a,
      competitor_count: stats[a.id]?.competitor_count ?? 0,
      recent_post_count: stats[a.id]?.recent_post_count ?? 0,
    })),
  });
}

// POST /api/accounts — create. Resolves Unipile provider_id when a profile
// URL is supplied so subsequent profile snapshots skip the slug lookup.
export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    profile_url?: string;
    brand_color?: string;
    logo_url?: string;
    niche_tag?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  let identifier: string | null = null;
  let provider_id: string | null = null;
  const profile_url = String(body.profile_url ?? "").trim() || null;

  if (profile_url) {
    const ident = identifierFromProfileUrl(profile_url);
    if (!ident) {
      return NextResponse.json(
        {
          error: "invalid_profile_url",
          message: `Could not parse a LinkedIn handle from "${profile_url}".`,
        },
        { status: 400 },
      );
    }
    identifier = ident;
    try {
      const resolved = await resolveProviderId(ident);
      provider_id = resolved.providerId;
    } catch (e) {
      // Soft-fail: still create the account, just without the cached
      // provider_id. Phase 3's snapshot worker will resolve later.
      if (e instanceof UnipileError) {
        console.warn("[accounts] provider_id resolution failed:", e.message);
      }
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name,
      identifier,
      profile_url,
      provider_id,
      brand_color: body.brand_color || "#C6F21F",
      logo_url: body.logo_url || null,
      niche_tag: body.niche_tag || null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "duplicate_identifier", message: `${identifier} is already an account` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ account: data });
}
