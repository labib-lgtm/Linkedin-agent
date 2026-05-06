import { NextResponse, type NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Service = "unipile" | "openrouter" | "supabase" | "google";

export async function POST(req: NextRequest) {
  let body: { service?: Service };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const service = body.service;
  switch (service) {
    case "unipile":
      return NextResponse.json(await testUnipile());
    case "openrouter":
      return NextResponse.json(await testOpenRouter());
    case "supabase":
      return NextResponse.json(await testSupabase());
    case "google":
      return NextResponse.json({
        ok: false,
        message: "Google OAuth probe not wired yet",
      });
    default:
      return NextResponse.json({ error: "unknown_service" }, { status: 400 });
  }
}

async function testUnipile() {
  const apiKey = await getSetting("unipile.api_key");
  const dsnRaw = await getSetting("unipile.dsn");
  const accountId = await getSetting("unipile.account_id");
  if (!apiKey || !dsnRaw || !accountId) {
    return { ok: false, message: "Set api_key, dsn, account_id first" };
  }
  const dsn = dsnRaw.replace(/\/$/, "");
  const url = `${dsn}/api/v1/accounts/${encodeURIComponent(accountId)}`;
  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const provider = String(data.provider ?? "linkedin");
      return { ok: true, message: `Connected — ${provider} account active` };
    }
    return {
      ok: false,
      message: `Unipile returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, message: `Network: ${(e as Error).message}` };
  }
}

async function testOpenRouter() {
  const apiKey = await getSetting("openrouter.api_key");
  if (!apiKey) return { ok: false, message: "Set api_key first" };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { data?: { label?: string; usage?: number } };
      const label = data.data?.label ?? "unnamed key";
      return { ok: true, message: `Authenticated — ${label}` };
    }
    return {
      ok: false,
      message: `OpenRouter returned ${res.status}`,
    };
  } catch (e) {
    return { ok: false, message: `Network: ${(e as Error).message}` };
  }
}

async function testSupabase() {
  try {
    const supabase = createServiceClient();
    const { error, count } = await supabase
      .from("angles")
      .select("*", { count: "exact", head: true });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `Connected — ${count ?? 0} angles in DB` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
