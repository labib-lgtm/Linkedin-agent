"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Pattern = {
  name?: string;
  description?: string;
  example_post_url?: string;
  applies_to_format?: string;
};

type TopPost = {
  post_id: string;
  competitor_id: string;
  creator?: string;
  role?: string;
  score: number;
  reactions?: number | null;
  comments?: number | null;
  reposts?: number | null;
  posted_at?: string | null;
  excerpt?: string;
};

export function DigestViewer({
  weekStart,
  generatedAtFormatted,
  topPosts,
  patternSummary,
}: {
  weekStart: string;
  generatedAtFormatted: string;
  topPosts: unknown;
  patternSummary: unknown;
}) {
  const posts = (Array.isArray(topPosts) ? topPosts : []) as TopPost[];
  const summary = patternSummary as { patterns?: Pattern[]; topics_in_niche?: string[] } | null;
  const patterns = summary?.patterns ?? [];
  const topics = summary?.topics_in_niche ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Week starting {weekStart} · generated {generatedAtFormatted}
      </p>

      {patterns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Hook + format patterns</CardTitle>
            <p className="text-xs text-muted-foreground">
              Promote any of these to feed the patterns table that drives angle generation.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {patterns.map((p, i) => (
              <PatternRow key={i} pattern={p} weekStart={weekStart} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {topics.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Amazon-niche topics getting traction</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-sm space-y-1">
              {topics.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {posts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Top posts feeding the digest</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-3 px-3">Creator</th>
                    <th className="py-3 px-3">Role</th>
                    <th className="py-3 px-3 text-right">Score</th>
                    <th className="py-3 px-3">Excerpt</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.post_id} className="border-b border-border last:border-0">
                      <td className="py-3 px-3">{p.creator}</td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">{p.role}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">{p.score}</td>
                      <td className="py-3 px-3">
                        <p className="line-clamp-2 max-w-xl">{p.excerpt}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PatternRow({ pattern, weekStart }: { pattern: Pattern; weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState(false);

  async function promote() {
    if (!pattern.name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/digest/${encodeURIComponent(weekStart)}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success(`Promoted "${pattern.name}" to patterns`);
      setPromoted(true);
      router.refresh();
    } catch (e) {
      toast.error(`Promote failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3 flex items-start gap-3">
      <div className="flex-1">
        <p className="font-medium text-sm">{pattern.name}</p>
        {pattern.description ? (
          <p className="text-xs text-muted-foreground mt-1">{pattern.description}</p>
        ) : null}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {pattern.applies_to_format ? (
            <span className="rounded-full bg-muted px-2 py-0.5 uppercase tracking-wide text-[10px]">
              {pattern.applies_to_format}
            </span>
          ) : null}
          {pattern.example_post_url ? (
            <a
              href={pattern.example_post_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-2 hover:underline"
            >
              example post
            </a>
          ) : null}
        </div>
      </div>
      <Button
        variant={promoted ? "ghost" : "outline"}
        size="sm"
        onClick={promote}
        disabled={busy || promoted}
      >
        {promoted ? "Promoted" : busy ? "..." : "Promote"}
      </Button>
    </div>
  );
}
