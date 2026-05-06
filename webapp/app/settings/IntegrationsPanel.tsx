"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupabaseEditDialog } from "./SupabaseEditDialog";
import type { SettingsPayload } from "./SettingsTabs";
import type { SettingService, SettingKey } from "@/lib/settings";

// Maps cover every SettingService for type-safety. The `services` array
// below decides which actually render here; `business` is rendered in
// BusinessPanel under its own tab.
const SERVICE_LABELS: Record<SettingService, string> = {
  unipile: "Unipile",
  openrouter: "OpenRouter",
  supabase: "Supabase",
  google: "Google",
  business: "Business",
};

const SERVICE_DESCRIPTIONS: Record<SettingService, string> = {
  unipile: "LinkedIn publishing + post fetch. DSN looks like 'api2.unipile.com:1234'.",
  openrouter: "LLM router used for angle generation and image rendering.",
  supabase:
    "Database. Editing service-role key disconnects the app — confirmation required, redeploy after save.",
  google: "OAuth client for Drive / Sheets (placeholder for now).",
  business: "Business profile — see the Business tab.",
};

export function IntegrationsPanel({
  data,
  onChange,
}: {
  data: SettingsPayload;
  onChange: (next: SettingsPayload) => void;
}) {
  const services: SettingService[] = ["unipile", "openrouter", "supabase", "google"];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {services.map((service) => (
        <ServiceCard
          key={service}
          service={service}
          fields={data.groups[service]}
          onSaved={onChange}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  service,
  fields,
  onSaved,
}: {
  service: SettingService;
  fields: SettingsPayload["groups"][SettingService];
  onSaved: (next: SettingsPayload) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const data = await res.json();
      setTestResult({ ok: !!data.ok, message: data.message ?? data.error ?? "" });
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{SERVICE_LABELS[service]}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          {SERVICE_DESCRIPTIONS[service]}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((field) => (
          <SettingField key={field.key} field={field} onSaved={onSaved} />
        ))}
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={test}
            disabled={testing}
          >
            {testing ? "Testing..." : "Test connection"}
          </Button>
          {testResult ? (
            <p
              className={`text-xs ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}
            >
              {testResult.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingField({
  field,
  onSaved,
}: {
  field: SettingsPayload["groups"][SettingService][number];
  onSaved: (next: SettingsPayload) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: field.key, value }),
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

  function attemptSave() {
    if (field.readOnly) {
      // readOnly = Supabase entries. Require explicit confirmation.
      setConfirmOpen(true);
      return;
    }
    save();
  }

  const sourceTag = field.source === "db" ? "DB" : field.source === "env" ? "env" : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>
          {field.label}
          {sourceTag ? (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              from {sourceTag}
            </span>
          ) : null}
        </Label>
        {!editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            {field.hasValue ? "Edit" : "Set"}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            type={field.secret ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.hasValue ? field.masked : ""}
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            onClick={attemptSave}
            disabled={saving || !value}
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
      ) : (
        <p className="text-xs font-mono text-muted-foreground">
          {field.hasValue ? field.masked : "— not set —"}
        </p>
      )}

      {field.readOnly ? (
        <SupabaseEditDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          fieldLabel={field.label}
          onConfirm={() => {
            setConfirmOpen(false);
            save();
          }}
        />
      ) : null}
    </div>
  );
}
