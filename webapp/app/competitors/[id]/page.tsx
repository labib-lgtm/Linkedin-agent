import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReanalyzeButton } from "./ReanalyzeButton";
import { PostsTable } from "./PostsTable";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  direct: "Direct competitor",
  format_source: "Format source",
  topic_source: "Topic source",
};

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { data: competitor, error: cErr } = await supabase
    .from("competitors")
    .select("*")
    .eq("id", id)
    .single();
  if (cErr || !competitor) {
    return (
      <div className="container-tight py-8">
        <h1 className="font-heading text-2xl font-bold">Not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {cErr?.message ?? "Competitor not found"}
        </p>
        <Link href="/competitors" className="mt-4 inline-block text-sm underline">
          Back to competitors
        </Link>
      </div>
    );
  }

  const { data: posts } = await supabase
    .from("competitor_posts")
    .select(
      "id, post_id, posted_at, text, reactions, comments, reposts, engagement_score, media_type, media_urls",
    )
    .eq("competitor_id", id)
    .order("engagement_score", { ascending: false });

  const top10 = (posts ?? []).slice(0, 10);

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div>
        <Link href="/competitors" className="text-xs text-muted-foreground underline">
          ← Competitors
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
              {competitor.display_name || competitor.identifier}
            </h1>
            <a
              href={competitor.profile_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-muted-foreground hover:underline"
            >
              {competitor.profile_url}
            </a>
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">{ROLE_LABEL[competitor.role] ?? competitor.role}</span>
              {competitor.last_analyzed_at ? (
                <span className="ml-2 text-muted-foreground">
                  · last analyzed {formatDate(competitor.last_analyzed_at)}
                </span>
              ) : null}
            </p>
          </div>
          <ReanalyzeButton id={id} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 posts by engagement</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Click any row to expand — full post text, media preview, and on-demand
            comments.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <PostsTable competitorId={id} posts={top10} />
        </CardContent>
      </Card>

      {(posts ?? []).length > 10 ? (
        <p className="text-xs text-muted-foreground">
          Showing top 10 of {posts?.length ?? 0} cached posts. Run digest to extract patterns
          across all of them.
        </p>
      ) : null}
    </div>
  );
}
