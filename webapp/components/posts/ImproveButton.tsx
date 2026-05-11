"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Inline "improve this" sparkle button + lightweight popover.
//
// Click the icon → small popover opens with a textarea for the operator's
// freeform correction ("make it more contrarian", "lead with the number").
// Apply → POST /api/posts/[angleId]/improve. On success the onApplied
// callback gets the full updated angle row so the parent can re-render
// without a full refetch.
//
// No Popover primitive in this repo — we hand-roll one with absolute
// positioning + a click-outside / Escape listener. Keeps the dependency
// surface flat and dodges the Radix-vs-vaul thrash.

export type ImproveTarget =
  | "hook"
  | "body"
  | "body-all"
  | "slide-copy"
  | "slide-image";

type Props = {
  angleId: string;
  target: ImproveTarget;
  /** 0-based for hook/body, 1-based for slide. Omit / 0 for body-all. */
  index?: number;
  /** Optional label override for the popover header. */
  label?: string;
  /** Disabled state from the parent (e.g. during another save). */
  disabled?: boolean;
  /** Position of the popover relative to the icon. Defaults to right-aligned below. */
  align?: "right" | "left";
  /** Called with the updated angle row from the server on a successful apply. */
  onApplied: (updatedAngle: Record<string, unknown>) => void;
};

const DEFAULT_LABELS: Record<ImproveTarget, string> = {
  hook: "Improve this hook",
  body: "Improve this paragraph",
  "body-all": "Improve the whole body",
  "slide-copy": "Improve this slide",
  "slide-image": "Improve the image brief",
};

const PLACEHOLDERS: Record<ImproveTarget, string> = {
  hook: "e.g. lead with the 78-comment stat",
  body: "e.g. tighten this to 2 sentences",
  "body-all": "e.g. make the whole thing more contrarian and cut the fluff",
  "slide-copy": "e.g. make the headline more contrarian",
  "slide-image": "e.g. less cluttered, just the laptop",
};

export function ImproveButton({
  angleId,
  target,
  index,
  label,
  disabled,
  align = "right",
  onApplied,
}: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Close on Escape or outside-click.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function apply() {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, index: index ?? 0, instruction: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      onApplied(data.angle as Record<string, unknown>);
      toast.success(
        target === "slide-image" && data.image_gen
          ? "Image brief updated. Generating 4 variants…"
          : "Updated.",
      );
      setOpen(false);
      setInstruction("");
    } catch (e) {
      toast.error(`Improve failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const titleText = label ?? DEFAULT_LABELS[target];

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={disabled}
        title={titleText}
        aria-label={titleText}
        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {/* Sparkles icon (inline SVG — no new dep). */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
          aria-hidden="true"
        >
          <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={titleText}
          className={`absolute top-7 z-50 w-80 rounded-lg border border-border bg-background shadow-lg p-3 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            {titleText}
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!submitting && instruction.trim()) apply();
              }
            }}
            placeholder={PLACEHOLDERS[target]}
            rows={3}
            maxLength={500}
            autoFocus
            className="w-full text-sm leading-snug bg-background border border-border rounded-md px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-lynx-green"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {instruction.length} / 500 · ⌘↵ to apply
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={submitting || !instruction.trim()}
                className="px-3 py-1 text-xs font-medium rounded-md bg-lynx-green text-lynx-charcoal hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {submitting ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
