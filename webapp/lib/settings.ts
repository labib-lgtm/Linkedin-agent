import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Centralised registry: every settings key the app reads is declared here
// with its env-var fallback. The Settings UI iterates over this list.
export const SETTING_KEYS = {
  "unipile.api_key":           { env: "UNIPILE_API_KEY",           secret: true,  service: "unipile" as const,    label: "API key" },
  "unipile.dsn":               { env: "UNIPILE_DSN",               secret: false, service: "unipile" as const,    label: "DSN host" },
  "unipile.account_id":        { env: "UNIPILE_LINKEDIN_ACCOUNT_ID", secret: false, service: "unipile" as const,  label: "LinkedIn account ID" },

  "openrouter.api_key":        { env: "OPENROUTER_API_KEY",        secret: true,  service: "openrouter" as const, label: "API key" },
  "openrouter.text_model":     { env: "OPENROUTER_TEXT_MODEL",     secret: false, service: "openrouter" as const, label: "Text model" },
  "openrouter.image_model":    { env: "OPENROUTER_IMAGE_MODEL",    secret: false, service: "openrouter" as const, label: "Image model" },

  "supabase.url":              { env: "NEXT_PUBLIC_SUPABASE_URL",  secret: false, service: "supabase" as const,   label: "Project URL", readOnly: true },
  "supabase.service_role_key": { env: "SUPABASE_SERVICE_ROLE_KEY", secret: true,  service: "supabase" as const,   label: "Service role key", readOnly: true },

  "google.client_id":          { env: "GOOGLE_CLIENT_ID",          secret: false, service: "google" as const,     label: "OAuth client ID" },
  "google.client_secret":      { env: "GOOGLE_CLIENT_SECRET",      secret: true,  service: "google" as const,     label: "OAuth client secret" },
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;
export type SettingService = (typeof SETTING_KEYS)[SettingKey]["service"];

let cache: { values: Record<string, string>; updated_at: string | null } | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5_000;

async function loadSettings(): Promise<{ values: Record<string, string>; updated_at: string | null }> {
  if (cache && Date.now() < cacheExpiry) return cache;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("values, updated_at")
      .eq("id", 1)
      .single();
    if (error || !data) {
      cache = { values: {}, updated_at: null };
    } else {
      cache = {
        values: (data.values as Record<string, string> | null) ?? {},
        updated_at: data.updated_at as string | null,
      };
    }
  } catch {
    // DB unreachable / table missing — fall through to env-only mode.
    cache = { values: {}, updated_at: null };
  }
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cache;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheExpiry = 0;
}

// Read a setting. DB value wins; env var is fallback. Empty string in DB
// counts as "not set" so the env fallback still applies.
export async function getSetting(key: SettingKey): Promise<string | null> {
  const { values } = await loadSettings();
  const dbValue = values[key];
  if (typeof dbValue === "string" && dbValue.length > 0) return dbValue;
  const envName = SETTING_KEYS[key].env;
  const envValue = process.env[envName];
  return envValue && envValue.length > 0 ? envValue : null;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const supabase = createServiceClient();
  const { values } = await loadSettings();
  const next = { ...values, [key]: value };
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: 1, values: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  invalidateSettingsCache();
}

export function maskSecret(value: string | null): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 3)}${"•".repeat(Math.max(4, value.length - 7))}${value.slice(-4)}`;
}

// Returns the structured payload the Settings UI expects.
export async function describeSettings() {
  const { values, updated_at } = await loadSettings();
  const out: Record<
    SettingService,
    Array<{
      key: SettingKey;
      label: string;
      hasValue: boolean;
      source: "db" | "env" | null;
      masked: string;
      readOnly: boolean;
      secret: boolean;
    }>
  > = { unipile: [], openrouter: [], supabase: [], google: [] };

  for (const k of Object.keys(SETTING_KEYS) as SettingKey[]) {
    const meta = SETTING_KEYS[k];
    const dbValue = values[k];
    const envValue = process.env[meta.env];
    const source: "db" | "env" | null =
      dbValue && dbValue.length > 0 ? "db" : envValue && envValue.length > 0 ? "env" : null;
    const raw = dbValue || envValue || "";
    out[meta.service].push({
      key: k,
      label: meta.label,
      hasValue: source !== null,
      source,
      masked: meta.secret ? maskSecret(raw) : raw,
      readOnly: ("readOnly" in meta ? meta.readOnly : false) ?? false,
      secret: meta.secret,
    });
  }
  return { groups: out, lastUpdated: updated_at };
}
