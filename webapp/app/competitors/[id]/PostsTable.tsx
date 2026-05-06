"use client";

import { useState, Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MediaTypeIcon, PostExpansion } from "@/components/competitors/PostExpansion";
import { shortDate } from "@/lib/utils";

type PostRow = {
  id: string;
  post_id: string;
  posted_at: string | null;
  text: string | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  engagement_score: number | string | null;
  media_type: string | null;
  media_urls: unknown;
};

export function PostsTable({
  competitorId,
  posts,
}: {
  competitorId: string;
  posts: PostRow[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (posts.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No posts yet. Click &ldquo;Re-analyze&rdquo; to fetch from Unipile.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
          <tr>
            <th className="py-3 pl-3 pr-1 w-6"></th>
            <th className="py-3 px-3">Posted</th>
            <th className="py-3 px-3 w-8">Type</th>
            <th className="py-3 px-3 text-right">Score</th>
            <th className="py-3 px-3 text-right">Likes</th>
            <th className="py-3 px-3 text-right">Comments</th>
            <th className="py-3 px-3 text-right">Reposts</th>
            <th className="py-3 px-3">Hook</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => {
            const isOpen = !!expanded[p.id];
            return (
              <Fragment key={p.id}>
                <tr
                  className="border-b border-border hover:bg-muted/30 cursor-pointer"
                  onClick={() => setExpanded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                >
                  <td className="py-3 pl-3 pr-1 text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </td>
                  <td className="py-3 px-3 text-xs text-muted-foreground">
                    {p.posted_at ? shortDate(p.posted_at) : "—"}
                  </td>
                  <td className="py-3 px-3">
                    <MediaTypeIcon mediaType={p.media_type} />
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
                {isOpen ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <PostExpansion
                        competitorId={competitorId}
                        postId={p.post_id}
                        text={p.text}
                        mediaUrls={
                          Array.isArray(p.media_urls)
                            ? (p.media_urls as Array<{
                                url: string;
                                type: "image" | "video" | "document" | "article" | "gif";
                                thumbnail_url?: string;
                                title?: string;
                              }>)
                            : null
                        }
                        mediaType={p.media_type}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
