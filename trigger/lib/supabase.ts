/**
 * Supabase client for the Trigger.dev engagement loop.
 *
 * Replaces the JWT/service-account dance in lib/sheets.ts with a thin
 * service-role-keyed Supabase client. Service-role bypasses RLS, which is
 * what we want for server-side writes from a cloud worker.
 *
 * Required env vars (set in cloud.trigger.dev → project → Environment Variables):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

let _client: SupabaseClient | null = null;

// Trigger.dev v4 runs on Node 21 which doesn't expose a global WebSocket.
// supabase-js initializes its realtime client at createClient time and
// throws on missing WebSocket even when we never use realtime. Pass the
// `ws` package as transport to satisfy the check; we still don't hit
// realtime endpoints anywhere in the worker so this is purely a startup
// requirement.
export function getServiceClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // ws's WebSocket has stricter event types than the browser's; cast
    // through `any` since supabase-js only uses the Construct signature
    // and the runtime works fine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: WebSocket as any },
  });
  return _client;
}

// Internal alias kept for legacy callers below.
const getClient = getServiceClient;

export interface PatchRecipientRowArgs {
  recipientId: string;
  fields: Record<string, string | number>;
}

/**
 * Patch a row on the lead_magnet_recipients table by recipient_id.
 * Same signature as the prior Sheets-backed function.
 */
export async function patchRecipientRow({
  recipientId,
  fields,
}: PatchRecipientRowArgs): Promise<void> {
  const { error } = await getClient()
    .from("lead_magnet_recipients")
    .update(fields)
    .eq("recipient_id", recipientId);
  if (error) throw new Error(`patchRecipientRow failed: ${error.message}`);
}

export interface InsertAuditEventArgs {
  angleId: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
}

/**
 * Append an event to the audit_log table. Best-effort — callers should wrap
 * in try/catch if the engagement-loop step must succeed regardless.
 */
export async function insertAuditEvent({
  angleId,
  eventType,
  payload,
}: InsertAuditEventArgs): Promise<void> {
  const { error } = await getClient().from("audit_log").insert({
    angle_id: angleId,
    event_type: eventType,
    payload: payload ?? {},
  });
  if (error) throw new Error(`insertAuditEvent failed: ${error.message}`);
}
