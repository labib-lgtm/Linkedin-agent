"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Star, Trash2 } from "lucide-react";
import { cn, shortDate } from "@/lib/utils";

type Competitor = {
  id: string;
  profile_url: string;
  identifier: string;
  display_name: string | null;
  role: string;
  active: boolean;
  last_analyzed_at: string | null;
  post_count: number;
  top_score: number;
  is_self?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  direct: "Direct",
  format_source: "Format",
  topic_source: "Topic",
};

const ROLE_TONE: Record<string, string> = {
  direct: "bg-blue-100 text-blue-800",
  format_source: "bg-violet-100 text-violet-800",
  topic_source: "bg-amber-100 text-amber-800",
};

// Deterministic avatar background from the identifier so each creator keeps
// a stable color across renders.
const AVATAR_TONES = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
];

function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CompetitorRow({
  competitor,
  maxTopScore,
}: {
  competitor: Competitor;
  maxTopScore: number;
}) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingSelf, setTogglingSelf] = useState(false);

  const name = competitor.display_name || competitor.identifier;
  const analyzed = competitor.post_count > 0;
  const scorePct =
    maxTopScore > 0 ? Math.max(2, Math.round((competitor.top_score / maxTopScore) * 100)) : 0;

  async function toggleSelf() {
    setTogglingSelf(true);
    try {
      const method = competitor.is_self ? "DELETE" : "POST";
      const res = await fetch(`/api/competitors/${competitor.id}/self`, { method });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(competitor.is_self ? "Cleared self flag" : "Marked as self — pinned in Compare");
      router.refresh();
    } catch (e) {
      toast.error(`Toggle failed: ${(e as Error).message}`);
    } finally {
      setTogglingSelf(false);
    }
  }

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/competitors/${competitor.id}/analyze`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = [data?.error, data?.body, data?.message].filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      toast.success(`Fetched ${data.fetched} posts`);
      router.refresh();
    } catch (e) {
      toast.error(`Analyze failed: ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function remove() {
    if (!confirm(`Stop tracking ${name}?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/competitors/${competitor.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Removed");
      router.refresh();
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 hover:bg-muted/30 transition-colors",
        competitor.is_self && "bg-lynx-green/5 ring-1 ring-inset ring-lynx-green/40",
      )}
    >
      {/* Creator */}
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              avatarTone(competitor.identifier),
            )}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {competitor.is_self ? (
                <Star
                  className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                  aria-label="Your own profile"
                />
              ) : null}
              <Link
                href={`/competitors/${competitor.id}`}
                className="truncate font-medium hover:underline"
              >
                {name}
              </Link>
            </div>
            <div className="truncate text-xs text-muted-foreground font-mono">
              {competitor.identifier}
            </div>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="py-2.5 px-3">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
            ROLE_TONE[competitor.role] ?? "bg-gray-100 text-gray-700",
          )}
        >
          {ROLE_LABEL[competitor.role] ?? competitor.role}
        </span>
      </td>

      {/* Posts */}
      <td className="py-2.5 px-3 text-right text-sm tabular-nums">
        {analyzed ? (
          competitor.post_count.toLocaleString()
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>

      {/* Top score with relative bar */}
      <td className="py-2.5 px-3">
        {analyzed ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-lynx-green"
                style={{ width: `${scorePct}%` }}
              />
            </div>
            <span className="text-sm tabular-nums">
              {Math.round(competitor.top_score).toLocaleString()}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* Last analyzed */}
      <td className="py-2.5 px-3 text-xs">
        {competitor.last_analyzed_at ? (
          <span className="text-muted-foreground">{shortDate(competitor.last_analyzed_at)}</span>
        ) : (
          <span className="italic text-muted-foreground/60">never</span>
        )}
      </td>

      {/* Actions — compact icon buttons */}
      <td className="py-2.5 px-3">
        <div className="flex items-center justify-end gap-1">
          <IconButton
            onClick={toggleSelf}
            busy={togglingSelf}
            title={competitor.is_self ? "Marked as self — click to clear" : "Mark as self (pin in Compare)"}
            active={competitor.is_self}
          >
            <Star className={cn("h-4 w-4", competitor.is_self && "fill-current")} />
          </IconButton>
          <IconButton
            onClick={analyze}
            busy={analyzing}
            title={analyzed ? "Re-analyze (refetch posts)" : "Analyze (fetch posts)"}
          >
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <IconButton
            onClick={remove}
            busy={deleting}
            title="Stop tracking"
            danger
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

function IconButton({
  children,
  onClick,
  busy,
  title,
  active,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  title: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-50",
        active
          ? "bg-lynx-green/15 text-lynx-charcoal hover:bg-lynx-green/25"
          : danger
            ? "text-muted-foreground hover:bg-red-50 hover:text-red-600"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
