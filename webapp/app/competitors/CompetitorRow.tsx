"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/utils";

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

export function CompetitorRow({ competitor }: { competitor: Competitor }) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingSelf, setTogglingSelf] = useState(false);

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
    if (!confirm(`Stop tracking ${competitor.display_name || competitor.identifier}?`)) return;
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
      className={
        competitor.is_self
          ? "border-b border-border last:border-0 bg-lynx-green/5 ring-1 ring-lynx-green/40"
          : "border-b border-border last:border-0"
      }
    >
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2">
          {competitor.is_self ? (
            <span
              title="This is your own profile — pinned in Compare as the baseline"
              className="text-amber-500 text-sm leading-none"
            >
              ★
            </span>
          ) : null}
          <Link href={`/competitors/${competitor.id}`} className="font-medium hover:underline">
            {competitor.display_name || competitor.identifier}
          </Link>
        </div>
        <div className="text-xs text-muted-foreground font-mono">{competitor.identifier}</div>
      </td>
      <td className="py-3 pr-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ROLE_TONE[competitor.role] ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {ROLE_LABEL[competitor.role] ?? competitor.role}
        </span>
      </td>
      <td className="py-3 pr-3 text-sm tabular-nums">{competitor.post_count}</td>
      <td className="py-3 pr-3 text-sm tabular-nums">{Math.round(competitor.top_score)}</td>
      <td className="py-3 pr-3 text-xs text-muted-foreground">
        {competitor.last_analyzed_at ? shortDate(competitor.last_analyzed_at) : "never"}
      </td>
      <td className="py-3 pr-3 text-right">
        <div className="inline-flex gap-2">
          <Button
            size="sm"
            variant={competitor.is_self ? "default" : "outline"}
            onClick={toggleSelf}
            disabled={togglingSelf}
            title={competitor.is_self ? "Currently marked as self" : "Mark as self (pin in Compare)"}
          >
            {togglingSelf ? "..." : competitor.is_self ? "★ Self" : "Mark self"}
          </Button>
          <Button size="sm" variant="outline" onClick={analyze} disabled={analyzing}>
            {analyzing ? "..." : competitor.post_count === 0 ? "Analyze" : "Re-analyze"}
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} disabled={deleting}>
            Remove
          </Button>
        </div>
      </td>
    </tr>
  );
}
