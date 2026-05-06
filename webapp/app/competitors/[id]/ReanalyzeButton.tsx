"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ReanalyzeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/competitors/${id}/analyze`, { method: "POST" });
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
      setBusy(false);
    }
  }

  return (
    <Button onClick={run} disabled={busy} variant="accent">
      {busy ? "Analyzing..." : "Re-analyze"}
    </Button>
  );
}
