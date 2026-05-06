import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReanalyzeButton } from "./ReanalyzeButton";
import { shortDate, formatDate } from "@/lib/utils";

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
    .select("*")
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
        </CardHeader>
        <CardContent className="p-0">
          {top10.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No posts yet. Click "Re-analyze" to fetch from Unipile.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-3 px-3">Posted</th>
                    <th className="py-3 px-3 text-right">Score</th>
                    <th className="py-3 px-3 text-right">Likes</th>
                    <th className="py-3 px-3 text-right">Comments</th>
                    <th className="py-3 px-3 text-right">Reposts</th>
                    <th className="py-3 px-3">Hook</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {p.posted_at ? shortDate(p.posted_at) : "—"}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {Math.round(Number(p.engagement_score ?? 0))}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{p.reactions ?? 0}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{p.comments ?? 0}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{p.reposts ?? 0}</td>
                      <td className="py-3 px-3">
                        <p className="line-clamp-2 max-w-xl">{(p.text ?? "").slice(0, 280)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
