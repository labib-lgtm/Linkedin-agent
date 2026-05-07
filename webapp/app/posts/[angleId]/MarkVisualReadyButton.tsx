"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { StudioAngle } from "./PostStudio";

export function MarkVisualReadyButton({
  angleId,
  onMarked,
}: {
  angleId: string;
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
        body: JSON.stringify({ status: "Visual Ready" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      onMarked?.(data.angle);
      toast.success("Marked Visual Ready — back to Pipeline");
      startTransition(() => router.push("/"));
    } catch (e) {
      toast.error(`Mark Visual Ready failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      onClick={flip}
      disabled={busy}
      className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
      title="Move to Visual Ready"
    >
      {busy ? "…" : "✓ Mark Visual Ready"}
    </Button>
  );
}
