"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type DigestTopPost = {
  post_id: string;
  competitor_id: string;
  creator?: string;
  role?: string;
  score: number;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  posted_at: string | null;
  excerpt: string;
};

type DigestReadOut = {
  week_start: string;
  top_posts: DigestTopPost[];
  llm_input: string;
  comps_count: number;
  generated_at: string;
};

type ApiError = { error?: string; message?: string; body?: string };

function detail(d: ApiError, status: number) {
  return [d.error, d.message, d.body].filter(Boolean).join(" — ") || `HTTP ${status}`;
}

export function RunDigestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"" | "Reading" | "Summarizing" | "Saving">("");

  async function run() {
    setBusy(true);
    try {
      // Phase 1 — DB reads only. Returns posts + the LLM prompt.
      setStep("Reading");
      const runRes = await fetch("/api/digest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const runData = (await runRes.json()) as { read?: DigestReadOut } & ApiError;
      if (!runRes.ok || !runData.read) {
        throw new Error(`read: ${detail(runData, runRes.status)}`);
      }

      // Phase 2 — LLM. Owns its own 10s budget.
      setStep("Summarizing");
      const sumRes = await fetch("/api/digest/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: runData.read }),
      });
      const sumData = (await sumRes.json()) as { summary?: unknown } & ApiError;
      if (!sumRes.ok || !sumData.summary) {
        throw new Error(`summarize: ${detail(sumData, sumRes.status)}`);
      }

      // Phase 3 — persist the merged payload.
      setStep("Saving");
      const merged = {
        week_start: runData.read.week_start,
        top_posts: runData.read.top_posts,
        pattern_summary: sumData.summary,
        generated_at: runData.read.generated_at,
      };
      const saveRes = await fetch("/api/digest/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: merged }),
      });
      const saveData = (await saveRes.json()) as ApiError;
      if (!saveRes.ok) {
        throw new Error(`save: ${detail(saveData, saveRes.status)}`);
      }

      toast.success("Digest generated");
      router.refresh();
    } catch (e) {
      toast.error(`Digest failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <Button onClick={run} disabled={busy} variant="accent">
      <Sparkles className="h-4 w-4" />
      {busy ? `${step}...` : "Run digest"}
    </Button>
  );
}
