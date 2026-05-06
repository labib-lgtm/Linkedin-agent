"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RunDigestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/digest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
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
