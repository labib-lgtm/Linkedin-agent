"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { StudioAngle } from "./PostStudio";

// Two-step ship: render PDF → confirm preview → publish.
// Per the roast: "Render succeeds, publish fails → PDF stranded in
// Storage. Make it two-step: render → preview the PDF inline →
// confirm publish."
//
// Step 1: POST /render-carousel-pdf — fires Trigger.dev task, polls
//         the angle row for carousel_pdf_path. Once present, move to
//         step 2.
// Step 2: POST /publish — Unipile multipart upload of the PDF.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

export function RenderAndPublishButton({
  angle,
  onUpdated,
}: {
  angle: StudioAngle;
  onUpdated?: (a: StudioAngle) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "rendering" | "preview" | "publishing" | "posted">(
    angle.carousel_pdf_path ? "preview" : "idle",
  );
  const [pdfPath, setPdfPath] = useState<string | null>(angle.carousel_pdf_path);
  const [, startTransition] = useTransition();

  async function startRender() {
    setPhase("rendering");
    try {
      const res = await fetch(`/api/posts/${angle.angle_id}/render-carousel-pdf`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      // Poll the angle row for carousel_pdf_path to land.
      const start = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - start > 180_000) {
          clearInterval(poll);
          toast.error("Render timed out after 3 min");
          setPhase("idle");
          return;
        }
        try {
          const r = await fetch(`/api/posts/${angle.angle_id}`);
          if (!r.ok) return;
          const d = await r.json();
          if (d.angle?.carousel_pdf_path) {
            clearInterval(poll);
            setPdfPath(d.angle.carousel_pdf_path);
            onUpdated?.(d.angle);
            setPhase("preview");
            toast.success("PDF rendered — preview below");
          }
        } catch {
          // ignore transient errors during polling
        }
      }, 4_000);
    } catch (e) {
      toast.error(`Render failed: ${(e as Error).message}`);
      setPhase("idle");
    }
  }

  async function publish() {
    setPhase("publishing");
    try {
      const res = await fetch(`/api/angles/${angle.angle_id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      toast.success("Posted to LinkedIn");
      setPhase("posted");
      startTransition(() => router.push("/"));
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message}`);
      setPhase("preview");
    }
  }

  const url = pdfPath ? `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${pdfPath}` : null;

  return (
    <div className="flex items-center gap-2">
      {phase === "preview" && url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-foreground/70 hover:text-foreground underline"
        >
          ↗ Preview PDF
        </a>
      ) : null}

      {phase === "preview" || phase === "publishing" ? (
        <Button
          size="sm"
          onClick={publish}
          disabled={phase === "publishing"}
          className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
        >
          {phase === "publishing" ? "Publishing…" : "↗ Publish to LinkedIn"}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={startRender}
          disabled={phase !== "idle"}
          className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
        >
          {phase === "rendering" ? "Rendering PDF…" : "Render & publish"}
        </Button>
      )}
    </div>
  );
}
