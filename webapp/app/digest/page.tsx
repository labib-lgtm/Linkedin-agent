import { createServiceClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunDigestButton } from "./RunDigestButton";
import { DigestViewer } from "./DigestViewer";
import { isoWeekStart, weekKeyFromStart } from "@/lib/week";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type DigestRow = {
  id: string;
  week_start: string;
  top_posts: unknown;
  pattern_summary: unknown;
  generated_at: string;
};

export default async function DigestPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();

  const { data: weeks } = await supabase
    .from("creator_digests")
    .select("id, week_start, generated_at")
    .order("week_start", { ascending: false });

  const selectedWeek = sp.week || weeks?.[0]?.week_start || isoWeekStart(new Date());
  const { data: digest } = await supabase
    .from("creator_digests")
    .select("*")
    .eq("week_start", selectedWeek)
    .maybeSingle();

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Weekly digest
          </h1>
          <p className="text-xs text-muted-foreground">
            LLM-extracted hook + format patterns from tracked creators.
          </p>
        </div>
        <RunDigestButton />
      </div>

      {(weeks ?? []).length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Week:</span>
          {(weeks as DigestRow[] | null ?? []).map((w) => (
            <a
              key={w.week_start}
              href={`/digest?week=${w.week_start}`}
              className={`rounded-full px-2.5 py-0.5 transition-colors ${
                w.week_start === selectedWeek
                  ? "bg-lynx-charcoal text-white"
                  : "bg-muted hover:bg-muted/70"
              }`}
            >
              {weekKeyFromStart(w.week_start)}
            </a>
          ))}
        </div>
      ) : null}

      {!digest ? (
        <Card>
          <CardHeader>
            <CardTitle>No digest for {selectedWeek}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Run analyze on at least one competitor first, then click "Run digest" above.
              The digest pulls top posts from the last 14 days and extracts patterns.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DigestViewer
          weekStart={digest.week_start as string}
          generatedAtFormatted={formatDate(digest.generated_at as string)}
          topPosts={digest.top_posts as unknown}
          patternSummary={digest.pattern_summary as unknown}
        />
      )}
    </div>
  );
}
