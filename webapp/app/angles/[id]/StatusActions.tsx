"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { STATUS_VALUES, type Status } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";

export function StatusActions({
  angleId,
  current,
}: {
  angleId: string;
  current: Status;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function setStatus(next: Status) {
    setError("");
    const res = await fetch(`/api/angles/${angleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Current:</span>
        <StatusBadge status={current} />
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUS_VALUES.filter((s) => s !== current).map((s) => (
          <Button
            key={s}
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setStatus(s)}
          >
            → {s}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
