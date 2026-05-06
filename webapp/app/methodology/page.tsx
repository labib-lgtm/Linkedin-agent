export const dynamic = "force-static";

export default function MethodologyPage() {
  return (
    <div className="container-tight py-8 sm:py-12 max-w-3xl">
      <h1 className="font-heading text-3xl sm:text-4xl font-bold tracking-tight mb-2">
        Methodology
      </h1>
      <p className="text-muted-foreground text-sm mb-10">
        How the numbers in Compare and Digest are computed. Every metric here is published so
        stakeholders can audit any claim the tool makes.
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Engagement score</h2>
        <p className="mb-3 text-sm">
          Every post fetched from LinkedIn gets a single engagement score, computed at write time
          as a generated stored column on <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">competitor_posts.engagement_score</code>:
        </p>
        <pre className="bg-muted text-foreground rounded-md p-4 text-sm font-mono mb-3">
{`score = reactions × 1 + comments × 3 + reposts × 5`}
        </pre>
        <p className="mb-2 text-sm">
          Why these weights: a comment is roughly three times as costly as a like to leave (people
          have to write something), and a repost re-broadcasts the post to a new audience, which is
          worth ~5x a like in distribution terms. The exact ratios are arguable — the point is to
          have <em>one</em> consistent number we can sort by, not a perfect proxy for revenue.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Worked example</h2>
        <p className="mb-3 text-sm">
          A post with 220 reactions, 18 comments, 3 reposts:
        </p>
        <pre className="bg-muted text-foreground rounded-md p-4 text-sm font-mono mb-3">
{`220 × 1   = 220
 18 × 3   =  54
  3 × 5   =  15
            ---
            289`}
        </pre>
        <p className="text-sm">
          The same post with 50 fewer reactions but 5 more comments would actually score{" "}
          <strong>254</strong> — slightly lower in raw reactions but with a higher quality signal
          per the formula. Adjust the weights in your head when reading the leaderboard.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Breakout posts</h2>
        <p className="mb-3 text-sm">
          A breakout is a post that scored at least <strong>3× the author&apos;s own 90-day median
          engagement_score</strong>. The frame is intentional: top-N is the wrong filter because
          some accounts simply post high-engagement content all the time. The alpha is in posts
          that surprised even the author — those are the ones worth dissecting.
        </p>
        <p className="mb-3 text-sm">
          Median (not mean) is used as the baseline because a single mega-post otherwise pulls the
          baseline up and hides genuine outliers.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Deltas vs Self</h2>
        <p className="mb-3 text-sm">
          Every metric in the leaderboard is shown as <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">value (±N% vs you)</code>{" "}
          where &ldquo;you&rdquo; is whichever competitor row is marked as Self. Mark one in{" "}
          <a href="/competitors" className="text-foreground underline">/competitors</a>; the
          leaderboard pins it at the top with <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">baseline</code>{" "}
          labels and computes deltas from there.
        </p>
        <p className="text-sm">
          A delta of <code className="font-mono text-xs">+340%</code> means the competitor&apos;s
          metric is 4.4× yours. <code className="font-mono text-xs">-50%</code> means theirs is
          half yours.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Closest analog</h2>
        <p className="mb-3 text-sm">
          The third InsightBanner card surfaces the competitor with the most similar{" "}
          <em>behavior pattern</em> to Self — same posts-per-week, similar avg score, similar
          format mix. Cosine similarity on a 7-dim vector{" "}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            [posts/wk, log(avg_score), text%, carousel%, video%, image%, poll%]
          </code>
          .
        </p>
        <p className="text-sm">
          The intent: when you&apos;re trying to grow, study the account that&apos;s closest to you
          in operating profile but ahead in engagement. Generic &ldquo;most viral&rdquo; competitors
          are rarely good models because their context doesn&apos;t match yours.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Hook patterns (Phase 1)</h2>
        <p className="mb-3 text-sm">
          The first InsightBanner card groups posts by their first-line prefix (60 chars, lowercased,
          punctuation stripped). It&apos;s a stand-in for real LLM hook extraction — useful for
          spotting copy-paste templates like &ldquo;I spent 42 hours&hellip;&rdquo; that show up
          across multiple posts, but it misses semantic equivalents (&ldquo;After 100 days&hellip;&rdquo;
          vs &ldquo;After three months&hellip;&rdquo;).
        </p>
        <p className="text-sm">
          Phase 4 replaces this with LLM-extracted hook templates and embedding-based clustering.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Where the data comes from</h2>
        <p className="text-sm mb-2">
          All metrics are computed from posts fetched via Unipile&apos;s LinkedIn API. The raw
          payload is stored in{" "}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">competitor_posts.raw</code>{" "}
          for debugging. Posts re-fetch daily via the cron at 6am UTC; click Re-analyze on a
          competitor to refresh on demand.
        </p>
        <p className="text-sm">
          The compare view&apos;s 28-day window is recomputed on every page load — there&apos;s no
          warehouse, no aggregation lag. Every number you see is current as of the last
          Re-analyze.
        </p>
      </section>
    </div>
  );
}
