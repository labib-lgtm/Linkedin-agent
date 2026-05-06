import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { Card, CardContent } from "@/components/ui/card";
import { CopyShareLink } from "./CopyShareLink";

export const dynamic = "force-dynamic";

// /reports — list of weekly reports for the active account, newest first.
// Each row has the share link + click-through to the public report page.
export default async function ReportsPage() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data: reports, error } = await supabase
    .from("client_reports")
    .select("id, week_start, share_token, generated_at")
    .eq("account_id", accountId)
    .order("week_start", { ascending: false })
    .limit(26);

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Weekly reports
        </h1>
        <p className="text-xs text-muted-foreground">
          Auto-generated every Monday morning. Click a report to view it; share the link with the
          client (no login required).
        </p>
      </div>

      {error ? (
        <p className="text-sm text-rose-700">Failed to load: {error.message}</p>
      ) : !reports || reports.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No reports yet. The Trigger.dev weekly-client-report task runs Mondays at 9am UTC. After
            it runs, reports for this account will appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => {
            const week = new Date(r.week_start as string);
            const generated = new Date(r.generated_at as string);
            const url = `/reports/${r.share_token}`;
            return (
              <div
                key={r.id as string}
                className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card hover:border-foreground/30 transition-colors"
              >
                <div>
                  <div className="font-semibold">
                    Week of{" "}
                    {week.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Generated{" "}
                    {generated.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CopyShareLink token={r.share_token as string} />
                  <Link
                    href={url}
                    className="text-sm font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted"
                  >
                    Open →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
