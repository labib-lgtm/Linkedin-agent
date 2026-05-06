"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";

// One-click copy for the public report URL. Lives as its own client
// component so the parent /reports page can stay server-rendered.
export function CopyShareLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const url = `${window.location.origin}/reports/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Share link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error(`Copy failed: ${(e as Error).message}`);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted"
      title="Copy share link"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
