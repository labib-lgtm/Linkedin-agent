"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { StudioAngle } from "./PostStudio";

export function MarkDraftedButton({
  angleId,
  disabled,
  onMarked,
}: {
  angleId: string;
  disabled?: boolean;
  onMarked?: (a: StudioAngle) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function flip() {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${angleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Drafted" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      onMarked?.(data.angle);
      toast.success("Marked drafted — back to Pipeline");
      startTransition(() => router.push("/"));
    } catch (e) {
      toast.error(`Mark drafted failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={flip}
      disabled={disabled || busy}
      title={disabled ? "Generate copy first" : "Move to Drafted"}
    >
      {busy ? "…" : "Mark drafted →"}
    </Button>
  );
}
