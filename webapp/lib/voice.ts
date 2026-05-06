import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Voice grounding for Post Studio prompts.
 *
 * Auto-pulls the last 5 posted angles' draft_body for the active account.
 * Cold-start fallback: if the account has < 3 posted angles, also reads
 * accounts.seed_voice_samples (operator-pasted representative posts) to
 * keep the LLM voice match grounded in real text rather than the 1-2
 * sentence business.voice description.
 *
 * Returns at most `limit` strings, deduped, trimmed, ordered most-recent
 * first.
 */
export async function getVoiceSamples(
  accountId: string,
  limit = 5,
): Promise<string[]> {
  const supabase = createServiceClient();

  const { data: posted } = await supabase
    .from("angles")
    .select("draft_body, date_posted")
    .eq("account_id", accountId)
    .eq("status", "Posted")
    .not("draft_body", "is", null)
    .order("date_posted", { ascending: false })
    .limit(limit);

  const samples: string[] = [];
  for (const row of posted ?? []) {
    const text = (row.draft_body as string | null)?.trim();
    if (text && text.length > 40) samples.push(text);
  }

  // Cold-start: pull seeded voice samples from the account row when
  // posted history is thin. The setting is one big text blob with posts
  // separated by blank lines; split on \n\n+ and trim.
  if (samples.length < 3) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("seed_voice_samples")
      .eq("id", accountId)
      .maybeSingle();
    const seeded = (acct?.seed_voice_samples as string | null) ?? "";
    for (const block of seeded.split(/\n{2,}/)) {
      const t = block.trim();
      if (!t || t.length < 40) continue;
      if (samples.length >= limit) break;
      samples.push(t);
    }
  }

  return samples.slice(0, limit);
}

/**
 * Returns the most recent N hook texts from posted angles for the active
 * account, used as the "avoid repetition" block in the post-copy prompt.
 * Resolved from selected_hook_index → hook_variants[i].text when set,
 * otherwise falls back to hook_chosen, then hook_seed.
 */
export async function getRecentHooks(
  accountId: string,
  days = 30,
): Promise<string[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("angles")
    .select("hook_variants, selected_hook_index, hook_chosen, hook_seed, date_posted")
    .eq("account_id", accountId)
    .eq("status", "Posted")
    .gte("date_posted", since)
    .order("date_posted", { ascending: false })
    .limit(40);

  const hooks: string[] = [];
  for (const row of data ?? []) {
    const variants = row.hook_variants as Array<{ text: string }> | null;
    const idx = row.selected_hook_index as number | null;
    const chosen =
      typeof idx === "number" && variants?.[idx]?.text
        ? variants[idx].text
        : (row.hook_chosen as string | null) ?? (row.hook_seed as string | null);
    const t = chosen?.trim();
    if (t) hooks.push(t);
  }
  return hooks;
}
