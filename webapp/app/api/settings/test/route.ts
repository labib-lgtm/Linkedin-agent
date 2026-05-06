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
  // Normalize the DSN the same way lib/unipile.ts does — accept either
  // bare host:port ("apiX.unipile.com:1234") or full URL.
  const trimmed = dsnRaw.trim().replace(/\/$/, "");
  const dsn = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  const url = `${dsn}/api/v1/accounts/${encodeURIComponent(accountId.trim())}`;
  // Manual abort timer (auto-unref'd) so the function terminates cleanly
  // when fetch returns early. AbortSignal.timeout would keep the lambda
  // alive until the 8s timer fires.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 8000);
  abortTimer.unref?.();
  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": apiKey.trim(), accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(abortTimer);
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
    clearTimeout(abortTimer);
    // Node fetch throws TypeError("fetch failed") and stashes the real
    // cause (ENOTFOUND, ECONNREFUSED, certificate errors, etc) on .cause.
    // Surface it so debugging doesn't require server logs.
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const causeMsg = err.cause?.code || err.cause?.message;
    const detail = causeMsg ? `${err.message} (${causeMsg})` : err.message;
    return { ok: false, message: `Network: ${detail} — tried ${dsn}` };
  }
}

async function testOpenRouter() {
  const apiKey = await getSetting("openrouter.api_key");
  if (!apiKey) return { ok: false, message: "Set api_key first" };
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 8000);
  abortTimer.unref?.();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(abortTimer);
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
    clearTimeout(abortTimer);
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
