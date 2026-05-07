"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  ink: string;
  paper: string;
};

type Account = {
  id: string;
  name: string;
  identifier: string | null;
  profile_url: string | null;
  brand_color: string | null;
  logo_url: string | null;
  niche_tag: string | null;
  seed_voice_samples: string | null;
  brand_palette: BrandPalette | null;
  brand_typography: string | null;
  brand_prompt_prefix: string | null;
  competitor_count: number;
  recent_post_count: number;
};

const DEFAULT_PALETTE: BrandPalette = {
  primary: "#C6F21F",
  secondary: "#666666",
  accent: "#b8543c",
  ink: "#0e0e0e",
  paper: "#fafafa",
};

// Settings → Accounts. Lists accounts, lets the operator add new ones,
// edit name/brand_color/niche/logo, or archive (soft delete).
export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const d = (await res.json()) as { accounts?: Account[] };
      setAccounts(d.accounts ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add an account</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Lynx manages multiple LinkedIn presences. Each account has its
            own competitors, digest, and angle pipeline. Add a name; the
            LinkedIn URL is optional but enables Phase 3 profile snapshots.
          </p>
        </CardHeader>
        <CardContent>
          <AddAccountForm onAdded={refresh} />
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading accounts...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddAccountForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [nicheTag, setNicheTag] = useState("");
  const [brandColor, setBrandColor] = useState("#C6F21F");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          profile_url: profileUrl.trim() || null,
          niche_tag: nicheTag.trim() || null,
          brand_color: brandColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = [data?.error, data?.message].filter(Boolean).join(" — ");
        throw new Error(detail || `HTTP ${res.status}`);
      }
      toast.success(`Added ${name}`);
      setName("");
      setProfileUrl("");
      setNicheTag("");
      setBrandColor("#C6F21F");
      onAdded();
    } catch (e) {
      toast.error(`Add failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="acct-name">Name</Label>
        <Input
          id="acct-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Founder, Lynx Media, etc."
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acct-url">LinkedIn URL (optional)</Label>
        <Input
          id="acct-url"
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          placeholder="https://www.linkedin.com/in/handle"
        />
      </div>
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="acct-niche">Niche tag (optional)</Label>
          <Input
            id="acct-niche"
            value={nicheTag}
            onChange={(e) => setNicheTag(e.target.value)}
            placeholder="Amazon PPC, DTC, B2B SaaS..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acct-color">Brand color</Label>
          <Input
            id="acct-color"
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="h-10 p-1"
          />
        </div>
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Adding..." : "Add account"}
      </Button>
    </form>
  );
}

function AccountCard({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [nicheTag, setNicheTag] = useState(account.niche_tag ?? "");
  const [logoUrl, setLogoUrl] = useState(account.logo_url ?? "");
  const [seedVoiceSamples, setSeedVoiceSamples] = useState(account.seed_voice_samples ?? "");
  const [palette, setPalette] = useState<BrandPalette>({
    ...DEFAULT_PALETTE,
    primary: account.brand_color ?? DEFAULT_PALETTE.primary,
    ...(account.brand_palette ?? {}),
  });
  const [typography, setTypography] = useState(account.brand_typography ?? "");
  const [brandPromptPrefix, setBrandPromptPrefix] = useState(account.brand_prompt_prefix ?? "");
  const [saving, setSaving] = useState(false);

  function updatePalette(key: keyof BrandPalette, value: string) {
    setPalette((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || account.name,
          niche_tag: nicheTag.trim() || null,
          brand_color: palette.primary,
          logo_url: logoUrl.trim() || null,
          seed_voice_samples: seedVoiceSamples.trim() || null,
          brand_palette: palette,
          brand_typography: typography.trim() || null,
          brand_prompt_prefix: brandPromptPrefix.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success("Saved");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive ${account.name}? Existing data is preserved but the account hides from pickers.`)) return;
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      toast.success("Archived");
      onChanged();
    } catch (e) {
      toast.error(`Archive failed: ${(e as Error).message}`);
    }
  }

  const initials = (account.name || "?").slice(0, 2).toUpperCase();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold text-white shrink-0"
            style={{ background: account.brand_color || "#0e0e0e" }}
          >
            {initials}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{account.name}</div>
            {account.identifier ? (
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {account.identifier}
              </div>
            ) : null}
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <div>{account.competitor_count} competitors</div>
            <div>{account.recent_post_count} posts (7d)</div>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-[10px] uppercase">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Label className="text-[10px] uppercase">Niche tag</Label>
            <Input value={nicheTag} onChange={(e) => setNicheTag(e.target.value)} />
            <div>
              <Label className="text-[10px] uppercase">Brand palette</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {(["primary", "secondary", "accent", "ink", "paper"] as const).map((k) => (
                  <div key={k}>
                    <input
                      type="color"
                      value={palette[k]}
                      onChange={(e) => updatePalette(k, e.target.value)}
                      className="w-full h-9 rounded border border-border cursor-pointer p-0"
                    />
                    <div className="text-[9px] text-muted-foreground text-center mt-0.5 capitalize">
                      {k}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
                Used by Phase B carousel slides + Phase C image gen brand prefix. Primary
                is the accent on cover slides; ink/paper are the slide background pair.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase">Logo URL</Label>
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px] uppercase">Typography</Label>
                <Input
                  value={typography}
                  onChange={(e) => setTypography(e.target.value)}
                  placeholder="e.g. Georgia headlines, Inter UI"
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase">Seed voice samples</Label>
              <Textarea
                value={seedVoiceSamples}
                onChange={(e) => setSeedVoiceSamples(e.target.value)}
                rows={6}
                placeholder={"Paste 3–5 representative LinkedIn posts (one per blank-line-separated block). Used for voice grounding until this account has 5+ posts under the system."}
                className="font-sans text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
                Cold-start fix. Once 5+ angles for this account hit Posted, the studio
                auto-pulls voice samples from those instead.
              </p>
            </div>
            <div>
              <Label className="text-[10px] uppercase">Brand prompt prefix · image gen</Label>
              <Textarea
                value={brandPromptPrefix}
                onChange={(e) => setBrandPromptPrefix(e.target.value)}
                rows={6}
                placeholder={`[STYLE BLOCK]\nEditorial illustration in {brand} style.\nCream paper texture #f3eee2 background, rust accent #b8543c.\nHand-drawn line art layered over geometric blocks. Slight grain overlay.\nNo photorealism. No people's faces. No corporate stock vibes.`}
                className="font-mono text-[11px]"
              />
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">
                Phase C prepends this to every image gen call so visuals compound into a
                recognizable brand style instead of looking like 100 different AI generations.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-rose-700" onClick={archive}>
              Archive
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
