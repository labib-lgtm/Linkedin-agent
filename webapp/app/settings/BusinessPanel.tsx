"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { SettingsPayload } from "./SettingsTabs";
import type { SettingKey } from "@/lib/settings";

// Business profile fields are different from integrations: free-form
// prose, multi-line, no test-connection step. Separate panel keeps
// IntegrationsPanel focused on credentials.

const FIELD_META: Record<
  string,
  { multiline: boolean; rows: number; placeholder: string; help: string }
> = {
  "business.name": {
    multiline: false,
    rows: 1,
    placeholder: "Lynx Media",
    help: "Used in prompt framing as your brand name.",
  },
  "business.description": {
    multiline: true,
    rows: 5,
    placeholder:
      "Helps Amazon sellers scale: PPC, listings, DSP, FBA, ranking, conversion. Open to TikTok content.",
    help:
      "What you do, who you serve, what channels you cover. The LLM uses this to decide which competitor topics are 'in-niche' and frames every angle around your scope.",
  },
  "business.audience": {
    multiline: true,
    rows: 3,
    placeholder:
      "Operators — Amazon brand owners, agency founders, in-house PPC managers, ecom marketers experimenting with TikTok.",
    help: "Who reads your LinkedIn posts. Determines tone and which gap your hooks fill.",
  },
  "business.voice": {
    multiline: true,
    rows: 4,
    placeholder:
      "Contrarian, specifics over platitudes, operator-grade. No em-dashes, no asterisks, no hash characters.",
    help:
      "Style rules. The 'no em-dashes / no asterisks' line keeps AI tells out of generated copy — keep it.",
  },
};

export function BusinessPanel({
  data,
  onChange,
}: {
  data: SettingsPayload;
  onChange: (next: SettingsPayload) => void;
}) {
  const fields = data.groups.business ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Drives the framing in every LLM prompt — digest pattern extraction and
          angle generation. Defaults are seeded so the app works out of the box;
          edit any field to adapt to a pivot or new channel without redeploying.
          Settings cache is 5 seconds, so changes propagate near-instantly.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => (
          <BusinessField
            key={field.key}
            field={field}
            meta={FIELD_META[field.key] ?? FIELD_META["business.description"]}
            onSaved={onChange}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BusinessField({
  field,
  meta,
  onSaved,
}: {
  field: SettingsPayload["groups"]["business"][number];
  meta: (typeof FIELD_META)[string];
  onSaved: (next: SettingsPayload) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.key as SettingKey, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved(data);
      toast.success(`Saved ${field.label}`);
      setEditing(false);
      setValue("");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const sourceTag = field.source === "db" ? "DB" : field.source === "env" ? "env" : "default";
  const currentDisplay = field.hasValue ? field.masked : "(using default)";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>
          {field.label}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {sourceTag}
          </span>
        </Label>
        {!editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(field.hasValue ? field.masked : "");
              setEditing(true);
            }}
          >
            {field.hasValue ? "Edit" : "Set"}
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{meta.help}</p>

      {editing ? (
        <div className="space-y-2">
          {meta.multiline ? (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={meta.placeholder}
              rows={meta.rows}
              autoFocus
            />
          ) : (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={meta.placeholder}
              autoFocus
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={saving || !value.trim()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setValue("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          {currentDisplay}
        </p>
      )}
    </div>
  );
}
