import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { type Recipient } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function RecipientsPage() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_magnet_recipients")
    .select("*")
    .order("queued_at", { ascending: false })
    .limit(500);

  const rs = (data ?? []) as Recipient[];

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Lead-magnet recipients
        </h1>
        <div className="text-xs text-muted-foreground">{rs.length} shown</div>
      </div>

      {error ? (
        <p className="text-sm text-red-700">Failed: {error.message}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Engagement-loop log</CardTitle>
        </CardHeader>
        <CardContent>
          {rs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No commenters logged yet.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Angle</th>
                    <th className="px-3 py-2">Commenter</th>
                    <th className="px-3 py-2">CTA</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Queued</th>
                    <th className="px-3 py-2">T+0 reply</th>
                    <th className="px-3 py-2">DM sent</th>
                    <th className="px-3 py-2">T+3h reply</th>
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.recipient_id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.angle_id ? (
                          <Link
                            href={`/angles/${r.angle_id}`}
                            className="text-blue-700 hover:underline"
                          >
                            {r.angle_id}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.commenter_name ?? r.commenter_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.cta_keyword ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="pill bg-muted text-foreground">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(r.queued_at)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(r.t0_reply_at)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(r.dm_sent_at)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(r.t3_reply_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
