"use client";

import { useState } from "react";
import { toast } from "sonner";

export type CoherenceScores = {
  word_count: number;
  char_count: number;
  hook_delivery: { ok: boolean; reason: string };
  cta_match: { ok: boolean; archetype: string; has_link: boolean; reason?: string };
  brand_match: { ok: boolean; average_score: number | null; checked: number };
  voice_grounded: { ok: boolean; samples_used: number };
  publishable: { ok: boolean; reason: string; model?: string };
  average: number;
};

// Bottom-right floating panel. Deterministic checks + one binary LLM
// publish call (per the roast). Click "Re-run" to refresh after edits.
export function CoherencePanel({
  angleId,
  scores,
  checkedAt,
  onScored,
}: {
  angleId: string;
  scores: CoherenceScores | null;
  checkedAt: string | null;
  onScored: (next: { coherence_scores: CoherenceScores; coherence_checked_at: string } & Record<string, unknown>) => void;
}) {
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/coherence`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      onScored(data.angle);
      toast.success(scores?.publishable?.ok ? "Re-checked" : "Coherence checked");
    } catch (e) {
      toast.error(`Check failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-40 px-3 py-2 rounded-full bg-foreground text-background text-xs font-semibold shadow-lg hover:bg-foreground/90"
      >
        ⚙ Coherence
      </button>
    );
  }

  return (
    <aside className="fixed bottom-4 right-4 z-40 w-[320px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] font-bold text-foreground">
          <span
            className={`w-2 h-2 rounded-full ${
              scores
                ? scores.publishable.ok
                  ? "bg-green-500 animate-pulse"
                  : "bg-amber-500"
                : "bg-muted-foreground"
            }`}
          />
          Coherence
        </div>
        <div className="flex items-center gap-2">
          {scores ? (
            <span
              className={`text-xs font-bold tabular-nums ${
                scores.publishable.ok ? "text-green-700" : "text-amber-700"
              }`}
            >
              {Math.round(scores.average * 100)}%
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground hover:text-foreground text-base leading-none"
            title="Collapse"
          >
            ×
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2 text-[11px]">
        {scores ? (
          <>
            <Row label="Hook delivery" ok={scores.hook_delivery.ok} detail={scores.hook_delivery.reason} />
            <Row
              label="CTA match"
              ok={scores.cta_match.ok}
              detail={
                scores.cta_match.reason
                  ? scores.cta_match.reason
                  : `${scores.cta_match.archetype}${scores.cta_match.has_link ? " · link present" : ""}`
              }
            />
            <Row
              label="Voice grounded"
              ok={scores.voice_grounded.ok}
              detail={`${scores.voice_grounded.samples_used} samples`}
            />
            <Row
              label="Brand match"
              ok={scores.brand_match.ok}
              detail={
                scores.brand_match.checked === 0
                  ? "no picked images yet"
                  : `${scores.brand_match.average_score ?? 0}/100 across ${scores.brand_match.checked} picked`
              }
              warn={scores.brand_match.checked === 0}
            />
            <div className="pt-2 mt-1 border-t border-border">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                    scores.publishable.ok ? "bg-green-500" : "bg-rose-500"
                  }`}
                />
                <div className="flex-1">
                  <div className="font-semibold">
                    {scores.publishable.ok ? "Publishable" : "Send back for revision"}
                  </div>
                  <p className="text-muted-foreground mt-0.5 leading-snug">
                    {scores.publishable.reason}
                  </p>
                </div>
              </div>
            </div>
            {checkedAt ? (
              <div className="text-[10px] text-muted-foreground pt-1">
                checked {new Date(checkedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-center py-4">
            Click <strong>Run check</strong> after generating copy and picking images to verify
            it&apos;s ready to publish.
          </p>
        )}

        <button
          type="button"
          onClick={run}
          disabled={running}
          className="w-full px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-semibold hover:bg-foreground/90 disabled:opacity-60"
        >
          {running ? "Checking…" : scores ? "↻ Re-run check" : "Run check"}
        </button>
      </div>
    </aside>
  );
}

function Row({
  label,
  ok,
  detail,
  warn,
}: {
  label: string;
  ok: boolean;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
          warn ? "bg-amber-500" : ok ? "bg-green-500" : "bg-rose-500"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-foreground font-medium">{label}</div>
        <div className="text-muted-foreground truncate">{detail}</div>
      </div>
    </div>
  );
}
