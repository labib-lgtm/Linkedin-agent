"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { StudioAngle } from "./PostStudio";
import { NewMagnetDialog, type LeadMagnet } from "@/app/settings/NewMagnetDialog";

const ROLE_LABEL: Record<string, string> = {
  hook: "Hook",
  setup: "Setup",
  pivot: "Pivot",
  list: "List",
  payoff: "Payoff",
  cta: "CTA",
};

const ROLE_TONE: Record<string, string> = {
  hook: "text-lynx-charcoal bg-lynx-green",
  setup: "text-muted-foreground bg-muted",
  pivot: "text-amber-700 bg-amber-50 border border-amber-200",
  list: "text-muted-foreground bg-muted",
  payoff: "text-lynx-charcoal bg-lynx-green/40",
  cta: "text-background bg-foreground",
};

const CTA_ARCHETYPES: Array<{ id: string; label: string; help: string }> = [
  { id: "follow", label: "Follow / Awareness", help: "Follow for more like this." },
  { id: "comment", label: "Comment driver", help: "What's yours? Drop it below." },
  { id: "dm", label: "DM / Lead", help: "DM 'KEYWORD' and I'll send it." },
  { id: "click", label: "Site click", help: "Full breakdown · link in pin comment." },
  { id: "demo", label: "Demo / Booking", help: "Book a 20-min audit · link." },
];

export function PostStudioCopy({
  angle,
  generating,
  onGenerate,
  onPatch,
}: {
  angle: StudioAngle;
  generating: boolean;
  onGenerate: (opts?: { hookOnly?: boolean; ctaOnly?: boolean; ctaArchetype?: string }) => Promise<void>;
  onPatch: (patch: Partial<StudioAngle>) => Promise<StudioAngle>;
}) {
  const hookVariants = angle.hook_variants ?? [];
  const selectedIdx = angle.selected_hook_index ?? 0;
  const paragraphs = angle.body_paragraphs ?? [];

  // Local mirror of the body paragraphs so the textarea edits stay
  // responsive while the network PATCH happens on blur.
  const [localBody, setLocalBody] = useState(paragraphs);
  useEffect(() => setLocalBody(paragraphs), [paragraphs]);

  const [localCta, setLocalCta] = useState(angle.cta_text ?? "");
  useEffect(() => setLocalCta(angle.cta_text ?? ""), [angle.cta_text]);

  const [localPin, setLocalPin] = useState(angle.pin_comment ?? "");
  useEffect(() => setLocalPin(angle.pin_comment ?? ""), [angle.pin_comment]);

  const [localDmTemplate, setLocalDmTemplate] = useState(angle.dm_response_template ?? "");
  useEffect(() => setLocalDmTemplate(angle.dm_response_template ?? ""), [angle.dm_response_template]);
  const [localDmIncludesLink, setLocalDmIncludesLink] = useState(angle.dm_response_includes_link ?? true);
  useEffect(() => setLocalDmIncludesLink(angle.dm_response_includes_link ?? true), [angle.dm_response_includes_link]);

  // Lead magnet library — fetched once per studio mount; refreshed when
  // the operator creates a new one inline via NewMagnetDialog.
  const [magnets, setMagnets] = useState<LeadMagnet[]>([]);
  const [magnetsLoaded, setMagnetsLoaded] = useState(false);
  const [newMagnetOpen, setNewMagnetOpen] = useState(false);

  async function loadMagnets() {
    try {
      const res = await fetch("/api/settings/lead-magnets");
      const d = (await res.json()) as { magnets?: LeadMagnet[] };
      setMagnets(d.magnets ?? []);
    } catch {
      // Soft-fail — picker just shows empty state.
    } finally {
      setMagnetsLoaded(true);
    }
  }
  useEffect(() => {
    loadMagnets();
  }, []);

  async function pickMagnet(magnetId: string) {
    const m = magnets.find((x) => x.id === magnetId);
    if (!m) return;
    try {
      await onPatch({
        lead_magnet_id: m.id,
        lead_magnet_url: m.url,
        lead_magnet_path: m.file_path,
      } as Partial<StudioAngle>);
      toast.success(`Attached "${m.label}"`);
    } catch (e) {
      toast.error(`Attach failed: ${(e as Error).message}`);
    }
  }

  async function clearMagnet() {
    try {
      await onPatch({
        lead_magnet_id: null,
        lead_magnet_url: null,
        lead_magnet_path: null,
      } as Partial<StudioAngle>);
      toast.success("Detached lead magnet");
    } catch (e) {
      toast.error(`Detach failed: ${(e as Error).message}`);
    }
  }

  const wordCount = paragraphs.reduce(
    (n, p) => n + (p.text.match(/\S+/g)?.length ?? 0),
    0,
  );
  const charCount = paragraphs.reduce((n, p) => n + p.text.length, 0);

  async function pickHook(i: number) {
    try {
      await onPatch({ selected_hook_index: i });
    } catch (e) {
      toast.error(`Hook pick failed: ${(e as Error).message}`);
    }
  }

  async function saveBody() {
    try {
      await onPatch({ body_paragraphs: localBody });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  async function saveCta() {
    if (localCta === (angle.cta_text ?? "")) return;
    try {
      await onPatch({ cta_text: localCta });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  async function savePin() {
    if (localPin === (angle.pin_comment ?? "")) return;
    try {
      await onPatch({ pin_comment: localPin });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  async function saveDmTemplate() {
    if (localDmTemplate === (angle.dm_response_template ?? "")) return;
    try {
      await onPatch({ dm_response_template: localDmTemplate });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  async function toggleDmLink() {
    const next = !localDmIncludesLink;
    setLocalDmIncludesLink(next);
    try {
      await onPatch({ dm_response_includes_link: next });
    } catch (e) {
      setLocalDmIncludesLink(!next);
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  }

  const [archetypeBusy, setArchetypeBusy] = useState(false);

  async function setArchetype(id: string) {
    if (id === angle.cta_archetype || archetypeBusy) return;
    setArchetypeBusy(true);
    try {
      // Optimistic chip flip while the regen runs.
      await onPatch({ cta_archetype: id });
      // Surgical CTA-only regen — keeps hooks + body intact, only
      // rewrites cta_text + pin_comment under the new archetype.
      await onGenerate({ ctaOnly: true, ctaArchetype: id });
    } catch (e) {
      toast.error(`Archetype change failed: ${(e as Error).message}`);
    } finally {
      setArchetypeBusy(false);
    }
  }

  if (hookVariants.length === 0) {
    return (
      <EmptyState
        generating={generating}
        onGenerate={() => onGenerate()}
        angle={angle}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Concept brief */}
      <section>
        <SectionHeader title="Concept brief · locked" />
        <div className="rounded-lg border border-border bg-background">
          <BriefRow k="Format" v={angle.format ?? "—"} />
          <BriefRow k="Pillar" v={angle.pillar ?? "—"} />
          <BriefRow
            k="CTA archetype"
            v={
              CTA_ARCHETYPES.find((c) => c.id === angle.cta_archetype)?.label ??
              "—"
            }
          />
          <BriefRow k="Promise" v={angle.gap_filled ?? "(angle has no gap_filled)"} />
          <BriefRow k="Approved angle" v={angle.hook_seed ?? "—"} />
        </div>
      </section>

      {/* Hooks */}
      <section>
        <SectionHeader
          title={`Hook · ${hookVariants.length} variants`}
          actionLabel={generating ? "Generating…" : "↻ Generate more"}
          actionDisabled={generating}
          onAction={() => onGenerate({ hookOnly: true })}
        />
        <div className="space-y-1.5">
          {hookVariants.map((v, i) => {
            const selected = i === selectedIdx;
            return (
              <button
                key={i}
                type="button"
                onClick={() => pickHook(i)}
                className={`w-full text-left grid gap-3 items-center px-3 py-2.5 rounded-lg border transition-colors ${
                  selected
                    ? "border-lynx-green bg-lynx-green/10 ring-1 ring-lynx-green"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
                style={{ gridTemplateColumns: "1fr auto" }}
              >
                <span className={`text-sm leading-snug ${selected ? "font-medium" : ""}`}>
                  {v.text}
                </span>
                {typeof v.voice_match_score === "number" ? (
                  <span
                    className={`text-[10px] tabular-nums px-2 py-0.5 rounded ${
                      selected
                        ? "bg-lynx-charcoal text-lynx-green"
                        : "bg-muted text-muted-foreground"
                    }`}
                    title="Model self-estimated voice match against your last 5 posts. Calibrate against real engagement once you have it."
                  >
                    {Math.round(v.voice_match_score * 100)}% voice
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Body */}
      <section>
        <SectionHeader
          title="Body · paragraph structure"
          actionLabel={generating ? "Generating…" : "↻ Regenerate body"}
          actionDisabled={generating}
          onAction={() => onGenerate()}
        />
        <div className="rounded-lg border border-border bg-background overflow-hidden divide-y divide-border">
          {localBody.map((p, i) => (
            <div
              key={i}
              className="grid gap-3 items-start px-3.5 py-3 hover:bg-muted/30 transition-colors"
              style={{ gridTemplateColumns: "1fr 90px" }}
            >
              <textarea
                value={p.text}
                onChange={(e) => {
                  const next = [...localBody];
                  next[i] = { ...p, text: e.target.value };
                  setLocalBody(next);
                }}
                onBlur={saveBody}
                rows={Math.max(1, Math.min(8, Math.ceil(p.text.length / 70)))}
                className="resize-none w-full text-sm leading-relaxed bg-transparent border-0 focus:outline-none focus:ring-0 p-0 font-sans"
              />
              <span
                className={`justify-self-end text-[9px] uppercase tracking-[0.14em] font-bold px-2 py-0.5 rounded ${
                  ROLE_TONE[p.role] ?? "bg-muted text-muted-foreground"
                }`}
              >
                {ROLE_LABEL[p.role] ?? p.role}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground tabular-nums">
          <span>
            <strong className="text-foreground">{wordCount}</strong> words
          </span>
          <span>·</span>
          <span>
            <strong className="text-foreground">{charCount}</strong> chars / 3,000 max
          </span>
          <span>·</span>
          <span title="Coherence + hook-delivery scoring lands in Phase D">
            Hook delivery / novelty:{" "}
            <span className="text-foreground">— (Phase D)</span>
          </span>
        </div>
      </section>

      {/* CTA */}
      <section>
        <SectionHeader title="CTA archetype" />
        <div className="flex flex-wrap gap-1.5 mb-2">
          {CTA_ARCHETYPES.map((c) => {
            const active = c.id === angle.cta_archetype;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setArchetype(c.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                  active
                    ? "bg-lynx-green text-lynx-charcoal border-lynx-green"
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
                title={c.help}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={localCta}
          onChange={(e) => setLocalCta(e.target.value)}
          onBlur={saveCta}
          rows={2}
          placeholder="CTA copy"
          className="w-full text-sm leading-relaxed bg-background border border-border border-l-[3px] border-l-lynx-green rounded-lg px-3.5 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-lynx-green"
        />
      </section>

      {/* DM auto-reply + lead magnet picker — visible for both DM and
          comment-driver CTAs (both flow through the same engagement loop). */}
      {angle.cta_archetype === "dm" || angle.cta_archetype === "comment" ? (
        <section>
          <SectionHeader
            title="DM auto-reply · sent when commenters reply with the keyword"
            actionLabel={generating ? "…" : "↻ Regenerate template"}
            actionDisabled={generating}
            onAction={() =>
              onGenerate({ ctaOnly: true, ctaArchetype: angle.cta_archetype ?? "dm" })
            }
          />
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
            {/* Lead magnet picker */}
            <div className="space-y-1.5">
              <span className="block text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
                Lead magnet
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={angle.lead_magnet_id ?? ""}
                  onChange={(e) => {
                    if (e.target.value) pickMagnet(e.target.value);
                    else clearMagnet();
                  }}
                  className="flex-1 text-sm bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">— None attached —</option>
                  {magnets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} {m.kind === "file" ? "📎" : "🔗"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNewMagnetOpen(true)}
                  className="text-[11px] font-medium px-2 py-1.5 rounded border border-border bg-background hover:bg-muted"
                >
                  + New
                </button>
              </div>
              {magnetsLoaded && magnets.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  No magnets in library yet. Click <strong>+ New</strong> or add one in
                  <a
                    href="/settings"
                    className="underline hover:text-foreground mx-1"
                  >
                    Settings → Lead Magnets
                  </a>.
                </p>
              ) : angle.lead_magnet_url ? (
                <p className="text-[10px] text-muted-foreground break-all">
                  Will substitute into <code className="text-[10px] bg-background px-1 py-0.5 rounded">{"{{lead_magnet_url}}"}</code>:
                  <a
                    href={angle.lead_magnet_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 underline hover:text-foreground font-mono"
                  >
                    {angle.lead_magnet_url.length > 50
                      ? `${angle.lead_magnet_url.slice(0, 47)}…`
                      : angle.lead_magnet_url}
                  </a>
                </p>
              ) : null}
            </div>

            <textarea
              value={localDmTemplate}
              onChange={(e) => setLocalDmTemplate(e.target.value)}
              onBlur={saveDmTemplate}
              rows={4}
              placeholder="The DM the bot sends to commenters who reply with your CTA keyword. Use {{lead_magnet_url}} as a placeholder for the link."
              className="w-full text-sm leading-relaxed bg-background border border-border rounded px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <label className="flex items-center gap-2 text-xs text-foreground/80">
              <input
                type="checkbox"
                checked={localDmIncludesLink}
                onChange={toggleDmLink}
                className="w-3.5 h-3.5"
              />
              Auto-substitute the lead magnet link into <code className="text-[10px] bg-background px-1 py-0.5 rounded">{"{{lead_magnet_url}}"}</code>
            </label>
            <p className="text-[10px] text-amber-800 leading-snug">
              Sent by the existing Trigger.dev cta-comment-response task when a commenter posts the cta_keyword.
              Placeholders: <code>{"{{commenter_name}}"}</code>, <code>{"{{lead_magnet_url}}"}</code>.
            </p>
          </div>

          <NewMagnetDialog
            open={newMagnetOpen}
            onClose={() => setNewMagnetOpen(false)}
            onCreated={async (created) => {
              await loadMagnets();
              await pickMagnet(created.id);
            }}
          />
        </section>
      ) : null}

      {/* Pin comment */}
      <section>
        <SectionHeader title="Pin comment · drops at T+4 min" />
        <textarea
          value={localPin}
          onChange={(e) => setLocalPin(e.target.value)}
          onBlur={savePin}
          rows={3}
          placeholder="Pin comment with the lead-magnet link or supplemental context"
          className="w-full text-xs leading-relaxed bg-background border border-dashed border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-foreground/40"
        />
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
        {title}
      </h3>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="text-[11px] text-foreground/70 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-muted"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function BriefRow({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="grid gap-3 px-3.5 py-2 text-[12px] border-b border-border last:border-0"
      style={{ gridTemplateColumns: "110px 1fr" }}
    >
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

function EmptyState({
  generating,
  onGenerate,
  angle,
}: {
  generating: boolean;
  onGenerate: () => void;
  angle: StudioAngle;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6">
      <h2 className="text-base font-semibold mb-1">Compose this post</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-4">
        Generates 5 hook variants, a role-tagged body, a CTA in the right archetype,
        and a pin comment — grounded in your last 5 posted angles + business voice.
      </p>
      {angle.hook_seed ? (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 mb-4 max-w-md">
          <strong className="text-foreground">Angle:</strong> {angle.hook_seed}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90 disabled:opacity-60 px-5 py-2.5 rounded-md text-sm font-semibold"
      >
        {generating ? "Generating…" : "Generate copy"}
      </button>
    </div>
  );
}
