"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY_PREFIX = "post-studio:voice-banner-dismissed:";

// Single nudge to add seed voice samples when an account is short
// (< 3). Dismissible per-account via localStorage. Once an account
// crosses the threshold via posted angles or seed paste, this stops
// rendering server-side anyway, so the dismissal only matters during
// the cold-start window.
export function VoiceSamplesBanner({
  accountId,
  samplesCount,
}: {
  accountId: string;
  samplesCount: number;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `${DISMISS_KEY_PREFIX}${accountId}`;
    setDismissed(window.localStorage.getItem(key) === "1");
  }, [accountId]);

  if (samplesCount >= 3 || dismissed) return null;

  function dismiss() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${accountId}`, "1");
    setDismissed(true);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 flex items-center gap-3 text-sm">
      <span className="text-amber-700 text-base leading-none">⚠</span>
      <div className="flex-1 leading-snug">
        <strong className="text-amber-900 font-semibold">Voice grounding is thin</strong>{" "}
        <span className="text-amber-800">
          ({samplesCount} sample{samplesCount === 1 ? "" : "s"} found, want ≥3). Paste 3–5
          representative LinkedIn posts so generated copy + image briefs match your real voice.
        </span>
      </div>
      <Link
        href="/settings"
        className="shrink-0 text-xs font-semibold text-amber-900 hover:text-amber-700 underline"
      >
        → Add seed samples
      </Link>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-amber-700 hover:text-amber-900 text-base leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
