import { logger, schedules } from "@trigger.dev/sdk/v3";
import { getServiceClient } from "./lib/supabase.js";
import { generateJson, generateEmbedding, cosine } from "./lib/openrouter.js";

/**
 * Daily post analysis — Phase 4 of Compare v2.
 *
 * For each non-archived account, find unanalyzed posts from the last
 * 60 days, extract a hook template via LLM, embed the post text, and
 * cluster posts into themes by cosine similarity. Updates per-account
 * hook_patterns + themes aggregates.
 *
 * Runs at 5:30am UTC daily, after profile_snapshot.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY
 */

// text-embedding-3-small puts on-topic posts at ~0.55-0.75 cosine, with
// duplicates near 0.85. The first run with threshold 0.78 produced 77
// themes from 106 posts (every post was its own cluster). Loosening to
// 0.62 — still strict enough to keep "Amazon PPC" separate from
// "TikTok ads", but loose enough that two posts on the same topic land
// together.
const CLUSTER_THRESHOLD = 0.62;
// Two themes whose centroids land within MERGE_THRESHOLD after clustering
// are folded into one (post-hoc cleanup pass below). Slightly higher than
// the join threshold so we only merge themes that *should have been* one.
const MERGE_THRESHOLD = 0.70;
const HOOK_SYSTEM = `You are an analyst extracting reusable LinkedIn hook templates from post first lines.

Given the first line of a post, return JSON:
{
  "hook_template": "Short, parameterized template like 'I spent X hours collecting Y' — keep capitalization from the original.",
  "hook_normalized": "Lowercased structural skeleton with ALL specifics replaced by placeholders. See examples."
}

NORMALIZATION RULES (critical for grouping):
- Replace ALL numbers, durations, named tools, named brands, named tactics, and product names with placeholders.
- Use 'x' for nouns/values, 'y' for objects/topics, 'z' if a third slot is needed.
- Replace synonyms with the dominant verb. Examples:
    "I spent 42 hours collecting Claude resources"   -> "i spent x hours collecting y"
    "I spent 12 days organizing Notion templates"    -> "i spent x days organizing y"   (different unit -> different group)
    "I spent 12 days collecting outbound playbooks"  -> "i spent x days collecting y"
    "After 100 days of testing TikTok ads"           -> "after x days of testing y"
    "These are the best AI tools I've tried"         -> "these are the best y i have x"
    "Most founders fail because of bad ICP fit"      -> "most x fail because of y"
    "7 lessons from running a $50M agency"           -> "x lessons from running a y"
    "Hot take: PPC is dead"                          -> "hot take y is x"
- Keep core verbs and conjunctions ("from", "because", "with", "after", "before", "for", "to").
- Strip emojis, hashtags, mentions, leading punctuation.
- If the first line is conversational filler ("Hey everyone", "Quick thought"), return template "" and normalized "".
- 3-10 words max in the normalized form.

Aim for normalized strings that ~5-10% of all peer-set posts could share. If your output is unique to a single post, you have not normalized enough.`;

type Account = { id: string; name: string };

type PostRow = {
  competitor_id: string;
  account_id: string;
  post_id: string;
  text: string | null;
  engagement_score: number | string | null;
};

type Theme = {
  id: string;
  account_id: string;
  centroid: number[] | null;
  post_count: number;
  avg_score: number;
};

const supabase = getServiceClient;

async function analyzeAccount(
  client: ReturnType<typeof supabase>,
  account: Account,
  budgetMs: number,
): Promise<{ analyzed: number; new_themes: number; errors: string[] }> {
  const start = Date.now();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();

  // Posts in the last 60 days that don't have an analysis row yet.
  // PostgREST doesn't do LEFT JOIN nicely, so we pull both and filter
  // in JS — typical sample is ≤300 posts/account, fine.
  const [{ data: posts }, { data: existing }] = await Promise.all([
    client
      .from("competitor_posts")
      .select("competitor_id, account_id, post_id, text, engagement_score")
      .eq("account_id", account.id)
      .gte("posted_at", since),
    client
      .from("competitor_post_analysis")
      .select("post_id, competitor_id")
      .eq("account_id", account.id),
  ]);

  const analyzedKey = new Set(
    ((existing as { post_id: string; competitor_id: string }[] | null) ?? []).map(
      (r) => `${r.competitor_id}:${r.post_id}`,
    ),
  );
  const todo = ((posts as PostRow[] | null) ?? []).filter(
    (p) => !analyzedKey.has(`${p.competitor_id}:${p.post_id}`) && p.text && p.text.trim().length > 30,
  );

  if (todo.length === 0) return { analyzed: 0, new_themes: 0, errors: [] };

  // Existing themes for this account (so we can join clusters).
  const { data: themesData } = await client
    .from("themes")
    .select("id, account_id, centroid, post_count, avg_score")
    .eq("account_id", account.id);
  const themes: Theme[] = ((themesData as Theme[] | null) ?? []).map((t) => ({
    ...t,
    centroid: Array.isArray(t.centroid) ? (t.centroid as number[]) : null,
  }));

  let analyzed = 0;
  let newThemes = 0;
  const errors: string[] = [];
  // For computing updated centroids, we need to reload posts that already
  // belong to a theme. Do it lazily on first new join.
  const themePostsCache: Record<string, number[][]> = {};

  for (const p of todo) {
    if (Date.now() - start > budgetMs) {
      logger.info("analyze: budget reached", { account: account.name, processed: analyzed });
      break;
    }
    try {
      const firstLine = (p.text ?? "").split(/\n/, 1)[0].slice(0, 300);
      const hookResult = await generateJson<{
        hook_template?: string;
        hook_normalized?: string;
      }>({
        system: HOOK_SYSTEM,
        user: firstLine,
        temperature: 0.2,
        maxTokens: 200,
        timeoutMs: 9_000,
      });
      const hook_template = (hookResult.hook_template ?? "").trim() || null;
      const hook_normalized = (hookResult.hook_normalized ?? "").trim() || null;

      // Embed the full text (truncated by the helper).
      const embedding = await generateEmbedding(p.text ?? "", { timeoutMs: 9_000 });

      // Find best matching theme.
      let theme_id: string | null = null;
      let bestSim = 0;
      for (const t of themes) {
        if (!t.centroid) continue;
        const sim = cosine(t.centroid, embedding);
        if (sim > bestSim && sim >= CLUSTER_THRESHOLD) {
          bestSim = sim;
          theme_id = t.id;
        }
      }

      if (!theme_id) {
        // New theme — name later, for now use a placeholder. We re-name
        // newly-formed themes at the end of the run.
        const { data: newTheme, error: tErr } = await client
          .from("themes")
          .insert({
            account_id: account.id,
            name: "Untitled cluster",
            centroid: embedding,
            post_count: 1,
            avg_score: Number(p.engagement_score ?? 0) || 0,
          })
          .select("id, account_id, centroid, post_count, avg_score")
          .single();
        if (tErr) {
          errors.push(`new theme: ${tErr.message}`);
          continue;
        }
        const created = newTheme as Theme;
        themes.push({ ...created, centroid: embedding });
        themePostsCache[created.id] = [embedding];
        theme_id = created.id;
        newThemes += 1;
      } else {
        // Join existing — incrementally update centroid by approximate mean.
        // We don't fetch all prior embeddings (too slow); instead use the
        // running-average formula: new_centroid = old + (new - old) / (n+1).
        const t = themes.find((x) => x.id === theme_id)!;
        const n = t.post_count;
        const updated = new Array<number>(embedding.length);
        const old = t.centroid ?? new Array<number>(embedding.length).fill(0);
        for (let i = 0; i < embedding.length; i++) {
          updated[i] = old[i] + (embedding[i] - old[i]) / (n + 1);
        }
        t.centroid = updated;
        t.post_count += 1;
        t.avg_score =
          (t.avg_score * n + (Number(p.engagement_score ?? 0) || 0)) / (n + 1);
        const { error: uErr } = await client
          .from("themes")
          .update({
            centroid: updated,
            post_count: t.post_count,
            avg_score: t.avg_score,
            last_clustered_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        if (uErr) errors.push(`theme update: ${uErr.message}`);
      }

      // Insert the analysis row.
      const wordCount = (p.text ?? "").trim().split(/\s+/).filter(Boolean).length;
      const { error: aErr } = await client.from("competitor_post_analysis").insert({
        post_id: p.post_id,
        competitor_id: p.competitor_id,
        account_id: p.account_id,
        hook_template,
        hook_normalized,
        word_count: wordCount,
        embedding,
        theme_id,
      });
      if (aErr) {
        errors.push(`analysis insert: ${aErr.message}`);
        continue;
      }
      analyzed += 1;
    } catch (e) {
      errors.push(`post ${p.post_id}: ${(e as Error).message}`);
    }

    // Be polite — embedding rate limits are generous but throttle anyway.
    await new Promise((r) => setTimeout(r, 200));
  }

  // Post-hoc merge pass — fold together themes whose centroids drifted
  // close after the greedy single-link assignment. Solves the "every
  // post becomes its own theme" failure mode that produced 77 themes
  // from 106 posts on the first run.
  const merged = await mergeCloseThemes(client, account.id);

  // Refresh hook_patterns aggregates: group competitor_post_analysis by
  // hook_normalized for this account, upsert into hook_patterns.
  await refreshHookPatterns(client, account.id);

  // Name unnamed themes via LLM. Bumped to top-10 (was 3) so a typical
  // run with several new clusters surfaces real names rather than a sea
  // of "Untitled cluster".
  await nameUntitledThemes(client, account.id);

  return { analyzed, new_themes: newThemes - merged, errors };
}

// Merge themes whose centroids are >= MERGE_THRESHOLD similar. The
// smaller theme (fewer posts) merges into the larger one. Repeats until
// no more merges are possible.
async function mergeCloseThemes(
  client: ReturnType<typeof supabase>,
  accountId: string,
): Promise<number> {
  let mergedCount = 0;
  for (let iter = 0; iter < 20; iter++) {
    const { data: themes } = await client
      .from("themes")
      .select("id, centroid, post_count")
      .eq("account_id", accountId);
    const ts = ((themes ?? []) as Array<{ id: string; centroid: number[] | null; post_count: number }>).filter(
      (t) => Array.isArray(t.centroid),
    );
    if (ts.length < 2) break;

    let bestPair: { a: string; b: string; sim: number } | null = null;
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const sim = cosine(ts[i].centroid as number[], ts[j].centroid as number[]);
        if (sim >= MERGE_THRESHOLD && (!bestPair || sim > bestPair.sim)) {
          bestPair = { a: ts[i].id, b: ts[j].id, sim };
        }
      }
    }
    if (!bestPair) break;

    const aTheme = ts.find((t) => t.id === bestPair!.a)!;
    const bTheme = ts.find((t) => t.id === bestPair!.b)!;
    // Bigger of the two absorbs the other.
    const survivor = aTheme.post_count >= bTheme.post_count ? aTheme : bTheme;
    const victim = survivor === aTheme ? bTheme : aTheme;

    // Re-point analysis rows from victim → survivor.
    await client
      .from("competitor_post_analysis")
      .update({ theme_id: survivor.id })
      .eq("account_id", accountId)
      .eq("theme_id", victim.id);

    // New centroid: weighted mean of the two.
    const total = survivor.post_count + victim.post_count;
    const newCentroid = (survivor.centroid as number[]).map((v, i) => {
      const sw = (v * survivor.post_count + (victim.centroid as number[])[i] * victim.post_count) / total;
      return sw;
    });
    await client
      .from("themes")
      .update({
        centroid: newCentroid,
        post_count: total,
        last_clustered_at: new Date().toISOString(),
      })
      .eq("id", survivor.id);

    // Remove victim. Surviving rows will have their leader recomputed
    // on the next /api/accounts/[id]/insights read; we don't denormalize
    // leader_competitor_id on themes here.
    await client.from("themes").delete().eq("id", victim.id);
    mergedCount += 1;
  }
  return mergedCount;
}

async function refreshHookPatterns(client: ReturnType<typeof supabase>, accountId: string) {
  const { data: rows } = await client
    .from("competitor_post_analysis")
    .select("hook_template, hook_normalized, post_id, competitor_id")
    .eq("account_id", accountId)
    .not("hook_normalized", "is", null);
  if (!rows || rows.length === 0) return;

  // Need engagement scores joined in — fetch separately.
  const postKeys = rows.map((r) => `${r.competitor_id}:${r.post_id}`);
  const compIds = [...new Set(rows.map((r) => r.competitor_id as string))];
  const { data: posts } = await client
    .from("competitor_posts")
    .select("competitor_id, post_id, engagement_score")
    .in("competitor_id", compIds);
  const scoreByKey: Record<string, number> = {};
  for (const p of posts ?? []) {
    scoreByKey[`${p.competitor_id}:${p.post_id}`] = Number(p.engagement_score ?? 0) || 0;
  }

  const groups: Record<string, { template: string; sum: number; count: number }> = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = String(r.hook_normalized ?? "");
    if (!key) continue;
    const score = scoreByKey[postKeys[i]] ?? 0;
    const g = groups[key] ?? { template: String(r.hook_template ?? key), sum: 0, count: 0 };
    g.sum += score;
    g.count += 1;
    groups[key] = g;
  }

  // No minimum sample count — single-sample patterns are still useful to
  // surface as long as the score is high. The UI shows the n= count
  // alongside avg_score so the operator can judge confidence.
  const upserts = Object.entries(groups)
    .filter(([, g]) => g.count >= 1)
    .map(([normalized_key, g]) => ({
      account_id: accountId,
      template: g.template,
      normalized_key,
      sample_count: g.count,
      avg_score: g.sum / g.count,
      last_clustered_at: new Date().toISOString(),
    }));

  if (upserts.length === 0) return;
  const { error } = await client
    .from("hook_patterns")
    .upsert(upserts, { onConflict: "account_id,normalized_key" });
  if (error) logger.warn("hook_patterns upsert failed", { error: error.message });
}

const THEME_NAME_SYSTEM = `You are naming a content cluster. Given 3-5 example post first-lines, return JSON:
{
  "name": "2-4 word cluster name (e.g. 'AI agents & Claude', 'Tool stacks / lists')",
  "summary": "One sentence describing the topic shared by these posts."
}

Rules:
- Name should be punchy, reusable, no jargon.
- No em-dashes, asterisks, or hash characters in any output.`;

async function nameUntitledThemes(
  client: ReturnType<typeof supabase>,
  accountId: string,
) {
  const { data: untitled } = await client
    .from("themes")
    .select("id, post_count")
    .eq("account_id", accountId)
    .eq("name", "Untitled cluster")
    .order("post_count", { ascending: false })
    .limit(10);
  if (!untitled || untitled.length === 0) return;

  for (const t of untitled) {
    const { data: examples } = await client
      .from("competitor_post_analysis")
      .select("post_id, competitor_id")
      .eq("theme_id", t.id)
      .limit(5);
    if (!examples || examples.length === 0) continue;
    // Get the corresponding text excerpts.
    const { data: posts } = await client
      .from("competitor_posts")
      .select("post_id, competitor_id, text")
      .in(
        "post_id",
        examples.map((e) => e.post_id as string),
      );
    const lines = (posts ?? [])
      .map((p) => `- ${(p.text ?? "").split("\n", 1)[0].slice(0, 160)}`)
      .join("\n");
    if (!lines) continue;
    try {
      const named = await generateJson<{ name?: string; summary?: string }>({
        system: THEME_NAME_SYSTEM,
        user: `Examples:\n${lines}\n\nReturn ONLY the JSON.`,
        temperature: 0.4,
        maxTokens: 150,
        timeoutMs: 9_000,
      });
      const name = (named.name ?? "").trim() || "Untitled cluster";
      const summary = (named.summary ?? "").trim() || null;
      await client
        .from("themes")
        .update({ name, llm_summary: summary })
        .eq("id", t.id);
    } catch (e) {
      logger.warn("theme name failed", { theme: t.id, error: (e as Error).message });
    }
  }
}

export const dailyAnalyzePosts = schedules.task({
  id: "daily-analyze-posts",
  cron: "30 5 * * *",        // 5:30am UTC, 30 min after profile_snapshot
  maxDuration: 60 * 30,       // 30 min ceiling
  run: async (_payload, { ctx }) => {
    const client = supabase();
    const { data: accounts } = await client
      .from("accounts")
      .select("id, name")
      .is("archived_at", null);

    logger.info("starting analyze run", {
      runId: ctx.run.id,
      accounts: accounts?.length ?? 0,
    });

    const summary: Array<{ account: string; analyzed: number; new_themes: number; errors: number }> = [];
    const PER_ACCOUNT_BUDGET = 5 * 60 * 1000; // 5 min each

    for (const a of (accounts ?? []) as Account[]) {
      const result = await analyzeAccount(client, a, PER_ACCOUNT_BUDGET);
      summary.push({
        account: a.name,
        analyzed: result.analyzed,
        new_themes: result.new_themes,
        errors: result.errors.length,
      });
      if (result.errors.length > 0) {
        logger.warn("account had errors", { account: a.name, errors: result.errors.slice(0, 5) });
      }
    }

    logger.info("analyze run complete", { summary });
    return { summary };
  },
});
