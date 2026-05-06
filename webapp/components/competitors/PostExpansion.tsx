"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Link as LinkIcon, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type MediaItem = {
  url: string;
  type: "image" | "video" | "document" | "article" | "gif";
  thumbnail_url?: string;
  title?: string;
};

type Comment = {
  comment_id: string;
  text: string | null;
  posted_at: string | null;
  commenter_name: string | null;
  commenter_identifier: string | null;
};

type CommentsResponse = {
  cached: boolean;
  fetched_at: string;
  comments: Comment[];
};

export function PostExpansion({
  competitorId,
  postId,
  text,
  mediaUrls,
  mediaType,
}: {
  competitorId: string;
  postId: string;
  text: string | null;
  mediaUrls: MediaItem[] | null;
  mediaType: string | null;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [cached, setCached] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadComments() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/competitors/${competitorId}/posts/${encodeURIComponent(postId)}/comments`,
        { method: "POST" },
      );
      const data = (await res.json()) as CommentsResponse & { error?: string; message?: string; body?: string };
      if (!res.ok) {
        const detail = [data.error, data.message, data.body].filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setComments(data.comments);
      setCached(data.cached);
      setFetchedAt(data.fetched_at);
    } catch (e) {
      toast.error(`Load comments failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 bg-muted/20 border-t border-border">
      {text ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Full post
          </h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        </div>
      ) : null}

      <div>
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Media
        </h4>
        <MediaPreview mediaUrls={mediaUrls} mediaType={mediaType} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
            Comments
          </h4>
          {comments === null ? (
            <Button size="sm" variant="outline" onClick={loadComments} disabled={loading}>
              {loading ? "Loading..." : "Load comments"}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {cached ? "cached" : "fresh"}
              {fetchedAt ? ` · fetched ${formatDate(fetchedAt)}` : null}
              {" · "}
              <button
                type="button"
                onClick={loadComments}
                disabled={loading}
                className="underline-offset-2 hover:underline"
              >
                {loading ? "..." : "refresh"}
              </button>
            </span>
          )}
        </div>
        {comments === null ? (
          <p className="text-xs text-muted-foreground italic">
            Click to fetch comments via Unipile (cached for 6h after first load).
          </p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No comments returned.</p>
        ) : (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.comment_id} className="rounded-md bg-background border border-border p-2.5">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-xs font-medium">
                    {c.commenter_name || c.commenter_identifier || "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {c.posted_at ? formatDate(c.posted_at) : ""}
                  </span>
                </div>
                <p className="text-xs whitespace-pre-wrap leading-snug">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MediaPreview({
  mediaUrls,
  mediaType,
}: {
  mediaUrls: MediaItem[] | null;
  mediaType: string | null;
}) {
  if (!mediaUrls || mediaUrls.length === 0 || mediaType === "none" || !mediaType) {
    return <p className="text-xs text-muted-foreground italic">No media attached.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {mediaUrls.map((m, i) => (
        <SingleMedia key={i} item={m} />
      ))}
    </div>
  );
}

function SingleMedia({ item }: { item: MediaItem }) {
  if (item.type === "image" || item.type === "gif") {
    return (
      <a href={item.url} target="_blank" rel="noreferrer noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.title || "post media"}
          loading="lazy"
          className="max-h-80 rounded-md border border-border object-contain bg-muted/20"
        />
      </a>
    );
  }
  if (item.type === "video") {
    return (
      <video
        controls
        poster={item.thumbnail_url}
        className="max-h-80 rounded-md border border-border bg-muted/20"
      >
        <source src={item.url} />
      </video>
    );
  }
  if (item.type === "document") {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted/50"
      >
        <FileText className="h-4 w-4" />
        {item.title || "Document"}
      </a>
    );
  }
  if (item.type === "article") {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-xs hover:bg-muted/50 max-w-md"
      >
        {item.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail_url}
            alt=""
            className="h-12 w-12 rounded object-cover"
          />
        ) : (
          <LinkIcon className="h-4 w-4" />
        )}
        <span className="line-clamp-2">{item.title || item.url}</span>
      </a>
    );
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-xs underline">
      {item.title || item.url}
    </a>
  );
}

export function MediaTypeIcon({ mediaType }: { mediaType: string | null }) {
  if (mediaType === "image" || mediaType === "gif") return <ImageIcon className="h-3.5 w-3.5" />;
  if (mediaType === "video") return <Video className="h-3.5 w-3.5" />;
  if (mediaType === "document") return <FileText className="h-3.5 w-3.5" />;
  if (mediaType === "article") return <LinkIcon className="h-3.5 w-3.5" />;
  return <span className="text-muted-foreground">—</span>;
}
