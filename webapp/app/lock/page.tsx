"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PIN_LENGTH = 4;

export default function LockPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const copy = [...prev];
      copy[i] = clean;
      return copy;
    });
    if (clean && i < PIN_LENGTH - 1) inputs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    } else if (e.key === "Enter") {
      submit();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array(PIN_LENGTH).fill("");
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    inputs.current[Math.min(text.length, PIN_LENGTH - 1)]?.focus();
  }

  async function submit() {
    const pin = digits.join("");
    if (pin.length !== PIN_LENGTH) {
      setError("Enter all 4 digits");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError("Too many wrong attempts. Try again in 15 minutes.");
      } else if (data?.error === "wrong_pin") {
        const remaining = data?.remaining ?? 0;
        setError(
          remaining > 0
            ? `Wrong PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
            : "Wrong PIN.",
        );
      } else {
        setError(data?.error || "Unlock failed");
      }
      setDigits(Array(PIN_LENGTH).fill(""));
      inputs.current[0]?.focus();
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="font-heading text-xl font-bold tracking-tight">
            <span className="rounded bg-lynx-green px-1.5 py-0.5">Lynx</span>{" "}
            LinkedIn Agent
          </div>
          <CardTitle className="mt-3">Enter PIN</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center gap-3" onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={1}
                disabled={pending}
                className="h-14 w-12 rounded-md border border-input bg-background text-center text-2xl font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ))}
          </div>
          {error ? (
            <p className="mt-4 text-center text-sm text-red-700">{error}</p>
          ) : null}
          <Button
            type="button"
            onClick={submit}
            disabled={pending}
            variant="accent"
            className="mt-6 w-full"
          >
            {pending ? "Unlocking..." : "Unlock"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
