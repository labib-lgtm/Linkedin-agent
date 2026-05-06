"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FormatValue, Status } from "@/lib/constants";

const PUBLISHABLE_STATUSES: Status[] = ["Visual Ready", "Drafted", "Scheduled"];

export function PublishButton({
  angleId,
  status,
  format,
}: {
  angleId: string;
  status: Status;
  format: FormatValue | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [postUrl, setPostUrl] = useState("");

  const canPublish = PUBLISHABLE_STATUSES.includes(status);
  const isMediaPost = format !== null && format !== "text";

  if (!canPublish) {
    return (
      <p className="text-xs text-muted-foreground">
        Status must be Visual Ready / Drafted / Scheduled to publish.
      </p>
    );
  }

  // Media posts can't publish from webapp (asset lives on local Mac).
  if (isMediaPost) {
    const cliCmd = `python3 tools/unipile_publish.py --angle-id ${angleId}`;
    return (
      <div className="space-y-2">
        <p className="text-sm">
          <span className="font-semibold">{format}</span> posts must be
          published from the CLI (asset lives on your local machine, not
          Vercel). Run this in your terminal:
        </p>
        <pre className="bg-muted text-xs px-3 py-2 rounded-md font-mono overflow-x-auto">
          {cliCmd}
        </pre>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(cliCmd)}
        >
          Copy command
        </Button>
      </div>
    );
  }

  async function publish() {
    if (!confirm(`Publish ${angleId} to LinkedIn now?`)) return;
    setSubmitting(true);
    setError("");
    setErrorDetail("");

    const res = await fetch(`/api/angles/${angleId}/publish`, {
      method: "POST",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed (${res.status})`);
      setErrorDetail(body.message ?? body.body ?? body.payload ?? "");
      setSubmitting(false);
      return;
    }

    const body = (await res.json()) as { post_url: string };
    setPostUrl(body.post_url);
    setSubmitting(false);
    startTransition(() => router.refresh());
  }

  if (postUrl) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-emerald-700">
          ✓ Published to LinkedIn
        </p>
        <Link
          href={postUrl}
          target="_blank"
          className="text-sm text-blue-700 hover:underline break-all"
        >
          {postUrl}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="accent"
        disabled={submitting || pending}
        onClick={publish}
      >
        {submitting ? "Publishing..." : "Publish to LinkedIn"}
      </Button>
      {error ? (
        <div className="text-xs text-red-700 space-y-1">
          <p className="font-semibold">{error}</p>
          {errorDetail ? (
            <pre className="text-[10px] whitespace-pre-wrap bg-red-50 border border-red-200 rounded p-2">
              {errorDetail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
