"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Slide } from "./SlideCard";

const ROLES = ["cover", "list-item", "framework-block", "chart", "quote", "divider", "payoff", "cta"];
const LAYOUTS = ["cover", "big-number", "big-stat", "chart", "inverted-cta"];
const VISUAL_ELEMENTS = [
  "blank",
  "single-icon",
  "icon-grid",
  "illustration",
  "bar-chart",
  "line-chart",
  "photo",
];
const COLOR_EMPHASES = ["primary", "secondary", "accent", "neutral", "inverted"];

export function SlideEditDrawer({
  open,
  slide,
  angleId,
  onClose,
  onSaved,
}: {
  open: boolean;
  slide: Slide | null;
  angleId: string;
  onClose: () => void;
  onSaved: (updatedAngle: { carousel_slides: Slide[] } & Record<string, unknown>) => void;
}) {
  const [headline, setHeadline] = useState("");
  const [supporting, setSupporting] = useState("");
  const [stat, setStat] = useState("");
  const [role, setRole] = useState("list-item");
  const [layout, setLayout] = useState("big-number");
  const [visualElement, setVisualElement] = useState("blank");
  const [colorEmphasis, setColorEmphasis] = useState("primary");
  const [imagePrompt, setImagePrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slide) return;
    setHeadline(slide.headline);
    setSupporting(slide.supporting ?? "");
    setStat(slide.stat ?? "");
    setRole(slide.role);
    setLayout(slide.layout);
    setVisualElement(slide.visual_element);
    setColorEmphasis(slide.color_emphasis);
    setImagePrompt(slide.image_gen_prompt ?? "");
  }, [slide]);

  if (!slide) return null;

  async function save() {
    if (!slide) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/slide/${slide.n}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline,
          supporting,
          stat,
          role,
          layout,
          visual_element: visualElement,
          color_emphasis: colorEmphasis,
          image_gen_prompt: imagePrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved(data.angle);
      toast.success(`Slide ${slide.n} saved`);
      onClose();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Edit slide {slide.n}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Headline, supporting text, stat, layout. Image gen prompt is read by
            Phase C when you generate per-slide illustrations.
          </p>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wider">Headline</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={120}
              placeholder="≤ 12 words"
            />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider">Supporting (optional)</Label>
            <Textarea
              value={supporting}
              onChange={(e) => setSupporting(e.target.value)}
              rows={2}
              placeholder="≤ 30 words"
            />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider">Stat (optional)</Label>
            <Input
              value={stat}
              onChange={(e) => setStat(e.target.value)}
              placeholder="e.g. Avg cost: $11k/mo"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider">Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider">Layout</Label>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              >
                {LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider">Visual element</Label>
              <select
                value={visualElement}
                onChange={(e) => setVisualElement(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              >
                {VISUAL_ELEMENTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider">Color emphasis</Label>
              <select
                value={colorEmphasis}
                onChange={(e) => setColorEmphasis(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
              >
                {COLOR_EMPHASES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider">
              Image gen prompt (Phase C uses this)
            </Label>
            <Textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              rows={3}
              placeholder="Editorial brief for the illustration. Leave blank for no illustration on this slide."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !headline.trim()}>
              {saving ? "Saving…" : "Save slide"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
