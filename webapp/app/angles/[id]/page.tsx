import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { type Angle, type Recipient } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusActions } from "./StatusActions";
import { PublishButton } from "./PublishButton";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AnglePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [{ data: angle, error: aErr }, { data: recipients }] = await Promise.all([
    supabase.from("angles").select("*").eq("angle_id", id).single(),
    supabase
      .from("lead_magnet_recipients")
      .select("*")
      .eq("angle_id", id)
      .order("queued_at", { ascending: false }),
  ]);

  if (aErr || !angle) notFound();
  const a = angle as Angle;
  const rs = (recipients ?? []) as Recipient[];

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Pipeline
          </Link>
          <h1 className="mt-1 font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            {a.angle_id}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {a.pillar ?? "—"} · {a.format ?? "—"} ·{" "}
            {a.week_assigned ?? "no week"}
          </p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusActions angleId={a.angle_id} current={a.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publish</CardTitle>
        </CardHeader>
        <CardContent>
          <PublishButton
            angleId={a.angle_id}
            status={a.status}
            format={a.format}
          />
        </CardContent>
      </Card>

      {a.hook_chosen ? (
        <Card>
          <CardHeader>
            <CardTitle>Hook</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium leading-relaxed">
              {a.hook_chosen}
            </p>
            {a.hook_alternates ? (
              <details className="mt-4">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Alternates
                </summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">
                  {a.hook_alternates}
                </pre>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Draft body</CardTitle>
        </CardHeader>
        <CardContent>
          {a.draft_body ? (
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
              {a.draft_body}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Not drafted yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CTA + Lead magnet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">CTA keyword:</span>{" "}
            {a.cta_keyword ? (
              <span className="font-mono font-bold bg-lynx-green text-lynx-charcoal px-1.5 py-0.5 rounded">
                {a.cta_keyword}
              </span>
            ) : (
              <span className="text-muted-foreground italic">none</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Lead magnet PDF:</span>{" "}
            {a.lead_magnet_url ? (
              <Link
                href={a.lead_magnet_url}
                target="_blank"
                className="text-blue-700 hover:underline break-all"
              >
                Open in Drive →
              </Link>
            ) : a.lead_magnet_path ? (
              <span className="font-mono text-xs">{a.lead_magnet_path}</span>
            ) : (
              <span className="text-muted-foreground italic">not built</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Asset path:</span>{" "}
            {a.asset_path ? (
              <span className="font-mono text-xs break-all">
                {a.asset_path}
              </span>
            ) : (
              <span className="text-muted-foreground italic">none</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publish info</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Posted at</div>
            <div>{formatDate(a.date_posted)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Approved at</div>
            <div>{formatDate(a.date_approved)}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-muted-foreground text-xs">Post URL</div>
            <div>
              {a.post_url ? (
                <Link
                  href={a.post_url}
                  target="_blank"
                  className="text-blue-700 hover:underline break-all"
                >
                  {a.post_url}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
          {a.critic_score ? (
            <div className="sm:col-span-2">
              <div className="text-muted-foreground text-xs">Critic score</div>
              <div className="font-mono text-xs">{a.critic_score}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Engagement-loop recipients ({rs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No CTA-keyword commenters yet.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Commenter</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Queued</th>
                    <th className="px-3 py-2">DM sent</th>
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.recipient_id} className="border-t border-border">
                      <td className="px-3 py-2">
                        {r.commenter_name ?? r.commenter_id ?? "—"}
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
                        {formatDate(r.dm_sent_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {a.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{a.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {a.post_url ? (
        <div>
          <Button asChild variant="accent">
            <Link href={a.post_url} target="_blank">
              Open post on LinkedIn →
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
