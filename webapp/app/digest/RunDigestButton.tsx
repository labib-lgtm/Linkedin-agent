"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type DigestPayload = {
  week_start: string;
  top_posts: unknown[];
  pattern_summary: unknown;
  generated_at: string;
};

export function RunDigestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      // Phase 1 — read + LLM. Returns the digest payload but does NOT
      // persist it (each call needs its own 10s budget on Hobby).
      const runRes = await fetch("/api/digest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const runData = (await runRes.json()) as {
        digest?: DigestPayload;
        error?: string;
        message?: string;
        body?: string;
      };
      if (!runRes.ok || !runData.digest) {
        const detail = [runData.error, runData.message, runData.body].filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${runRes.status}`);
      }

      // Phase 2 — persist. Separate request, separate budget.
      const saveRes = await fetch("/api/digest/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: runData.digest }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        const detail = [saveData?.error, saveData?.message, saveData?.body]
          .filter(Boolean)
          .join(" — ");
        throw new Error(`save: ${detail || `HTTP ${saveRes.status}`}`);
      }

      toast.success("Digest generated");
      router.refresh();
    } catch (e) {
      toast.error(`Digest failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy} variant="accent">
      <Sparkles className="h-4 w-4" />
      {busy ? "Running..." : "Run digest"}
    </Button>
  );
}
