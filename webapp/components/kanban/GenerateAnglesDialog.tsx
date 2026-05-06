"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PILLAR_VALUES,
  FORMAT_VALUES,
  type Pillar,
  type FormatValue,
} from "@/lib/constants";

type Draft = { hook_seed: string; cta_keyword: string; gap_filled: string };
type Step = "form" | "review";

export function GenerateAnglesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");

  // form state
  const [topic, setTopic] = useState("");
  const [pillar, setPillar] = useState<Pillar>(PILLAR_VALUES[0]);
  const [format, setFormat] = useState<FormatValue>("text");
  const [count, setCount] = useState(3);
  const [generating, setGenerating] = useState(false);

  // review state
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [committing, setCommitting] = useState(false);

  function reset() {
    setStep("form");
    setTopic("");
    setPillar(PILLAR_VALUES[0]);
    setFormat("text");
    setCount(3);
    setDrafts([]);
    setSelected([]);
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function generate() {
    if (!topic.trim()) {
      toast.error("Topic is required");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/angles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, pillar, format, count }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = [data?.error, data?.message, data?.body]
          .filter(Boolean)
          .join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const list: Draft[] = data.drafts ?? [];
      if (list.length === 0) {
        toast.error("Model returned no drafts. Try a more specific topic.");
        return;
      }
      setDrafts(list);
      setSelected(list.map(() => true));
      setStep("review");
    } catch (e) {
      toast.error(`Generate failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function commit() {
    const items = drafts
      .map((d, i) => ({ ...d, included: selected[i] }))
      .filter((d) => d.included)
      .map(({ included: _ig, ...d }) => ({ ...d, pillar, format }));

    if (items.length === 0) {
      toast.error("Pick at least one angle to commit");
      return;
    }

    setCommitting(true);
    try {
      const res = await fetch("/api/angles/generate/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const inserted = (data.inserted ?? []).length;
      toast.success(`Committed ${inserted} angle${inserted === 1 ? "" : "s"} to Pending`);
      handleClose(false);
      router.refresh();
    } catch (e) {
      toast.error(`Commit failed: ${(e as Error).message}`);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Generate angles</DialogTitle>
              <DialogDescription>
                Drafts get reviewed before they hit the Pending column.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="topic">Topic</Label>
                <Textarea
                  id="topic"
                  rows={3}
                  placeholder="e.g. 'How my best client cut ACoS 40% in 30 days' or 'Why TikTok ads beat PPC for new launches'"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Pillar</Label>
                  <Select value={pillar} onValueChange={(v) => setPillar(v as Pillar)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PILLAR_VALUES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as FormatValue)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT_VALUES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="count">Count</Label>
                  <Input
                    id="count"
                    type="number"
                    min={1}
                    max={8}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={generate} disabled={generating}>
                {generating ? "Generating..." : "Generate"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review drafts</DialogTitle>
              <DialogDescription>
                Untick anything you don't want. Edit fields if needed before committing.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
              {drafts.map((d, i) => (
                <div
                  key={i}
                  className={`rounded-md border p-3 ${
                    selected[i] ? "border-border bg-background" : "border-border bg-muted/40 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected[i]}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const copy = [...prev];
                          copy[i] = e.target.checked;
                          return copy;
                        })
                      }
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Hook seed
                        </Label>
                        <Textarea
                          rows={2}
                          value={d.hook_seed}
                          onChange={(e) =>
                            setDrafts((prev) => {
                              const copy = [...prev];
                              copy[i] = { ...copy[i], hook_seed: e.target.value };
                              return copy;
                            })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            CTA keyword
                          </Label>
                          <Input
                            value={d.cta_keyword}
                            onChange={(e) =>
                              setDrafts((prev) => {
                                const copy = [...prev];
                                copy[i] = { ...copy[i], cta_keyword: e.target.value.toUpperCase() };
                                return copy;
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Gap filled
                          </Label>
                          <Input
                            value={d.gap_filled}
                            onChange={(e) =>
                              setDrafts((prev) => {
                                const copy = [...prev];
                                copy[i] = { ...copy[i], gap_filled: e.target.value };
                                return copy;
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("form")}>
                Back
              </Button>
              <Button variant="accent" onClick={commit} disabled={committing}>
                {committing ? "Committing..." : `Commit ${selected.filter(Boolean).length} to Pending`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
