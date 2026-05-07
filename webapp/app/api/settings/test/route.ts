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
    // Run the auth probe + the model-catalog fetch in parallel so the
    // 8s budget covers both. Catalog is ~150 KB, ~500ms typical.
    const [authRes, modelsRes] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
        signal: controller.signal,
      }),
      fetch("https://openrouter.ai/api/v1/models", {
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
    ]);
    clearTimeout(abortTimer);

    if (!authRes.ok) {
      return { ok: false, message: `OpenRouter auth returned ${authRes.status}` };
    }
    const authData = (await authRes.json().catch(() => ({}))) as {
      data?: { label?: string; usage?: number };
    };
    const label = authData.data?.label ?? "unnamed key";

    // Validate the configured image model + text model are both in the
    // OpenRouter catalog. Catches typos in the model id before any
    // generation actually fires.
    const imageModel = await getSetting("openrouter.image_model");
    const textModel = await getSetting("openrouter.text_model");

    let modelMsg = "";
    if (modelsRes.ok && (imageModel || textModel)) {
      type ModelEntry = { id?: string };
      type ModelsPayload = { data?: ModelEntry[] };
      const models = (await modelsRes.json().catch(() => ({}))) as ModelsPayload;
      const ids = new Set(
        (models.data ?? []).map((m) => (m.id ?? "").toLowerCase()),
      );

      const issues: string[] = [];
      if (imageModel && !ids.has(imageModel.toLowerCase())) {
        const suggestion = guessModel(imageModel, ids);
        issues.push(
          suggestion
            ? `image model "${imageModel}" not found — did you mean "${suggestion}"?`
            : `image model "${imageModel}" not found in catalog`,
        );
      }
      if (textModel && !ids.has(textModel.toLowerCase())) {
        const suggestion = guessModel(textModel, ids);
        issues.push(
          suggestion
            ? `text model "${textModel}" not found — did you mean "${suggestion}"?`
            : `text model "${textModel}" not found in catalog`,
        );
      }
      if (issues.length > 0) {
        return { ok: false, message: `Auth OK (${label}). ${issues.join(" · ")}` };
      }
      const checked: string[] = [];
      if (imageModel) checked.push(`image=${imageModel}`);
      if (textModel) checked.push(`text=${textModel}`);
      modelMsg = checked.length > 0 ? ` · ${checked.join(", ")} valid` : "";
    }

    return { ok: true, message: `Authenticated — ${label}${modelMsg}` };
  } catch (e) {
    clearTimeout(abortTimer);
    return { ok: false, message: `Network: ${(e as Error).message}` };
  }
}

// Tiny similarity guess to surface "did you mean" when the configured
// id isn't in the catalog. Substring containment is enough for typo
// catches like "gpt-5-image-mini" vs "gpt-image-1-mini".
function guessModel(target: string, catalog: Set<string>): string | null {
  const t = target.toLowerCase();
  // Provider/family root, e.g. "openai/gpt" from "openai/gpt-5-image-mini"
  const root = t.replace(/[\d-]+(image|mini|preview|pro|flash)?$/g, "").replace(/-+$/, "");
  if (root.length < 4) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const id of catalog) {
    if (!id.startsWith(root.split("-")[0])) continue;
    let score = 0;
    if (id.includes("image")) score += 2;
    if (t.includes("mini") && id.includes("mini")) score += 2;
    if (t.includes("preview") && id.includes("preview")) score += 1;
    if (id.includes(root)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore >= 2 ? best : null;
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
