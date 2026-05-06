"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

type Account = {
  id: string;
  name: string;
  brand_color: string | null;
  logo_url: string | null;
  niche_tag: string | null;
};

// Right-side header dropdown: shows the current account + lets the operator
// switch context. Uses the lynx_active_account cookie via /api/accounts/switch.
// Loads the account list lazily when first opened.
export function AccountSwitcher() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load on mount so we can render the active label without flicker.
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d: { accounts?: Account[] }) => {
        const list = d.accounts ?? [];
        setAccounts(list);
        // Active = first cookie-resolved or first overall. The actual
        // active id is server-resolved on every request via getActiveAccountId,
        // so this is just for display. Read the cookie to mirror what the
        // server picked.
        const cookieMatch = document.cookie.match(/lynx_active_account=([^;]+)/);
        const cookieId = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
        const found = (cookieId && list.find((a) => a.id === cookieId)) || list[0] || null;
        setActive(found);
      })
      .catch(() => {});
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function switchTo(accountId: string) {
    setSwitching(true);
    try {
      const res = await fetch("/api/accounts/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = accounts.find((a) => a.id === accountId);
      if (next) setActive(next);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(`Switch failed: ${(e as Error).message}`);
    } finally {
      setSwitching(false);
    }
  }

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

  if (!active) return null;

  const initials = (active.name || "?").slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
        className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted text-sm"
      >
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white"
          style={{ background: active.brand_color || "#0e0e0e" }}
        >
          {initials}
        </span>
        <span className="font-medium max-w-[140px] truncate">{active.name}</span>
        {accounts.length > 1 ? (
          <span className="text-[10px] text-muted-foreground">· {accounts.length}</span>
        ) : null}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute right-0 mt-1.5 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Switch account
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
            ) : accounts.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No accounts.</div>
            ) : (
              accounts.map((a) => {
                const init = (a.name || "?").slice(0, 2).toUpperCase();
                const isActive = active.id === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => switchTo(a.id)}
                    disabled={switching || isActive}
                    className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60 ${
                      isActive ? "bg-lynx-green/10" : ""
                    }`}
                  >
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold text-white"
                      style={{ background: a.brand_color || "#0e0e0e" }}
                    >
                      {init}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      {a.niche_tag ? (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {a.niche_tag}
                        </div>
                      ) : null}
                    </div>
                    {isActive ? (
                      <span className="text-[10px] font-bold text-lynx-charcoal bg-lynx-green px-1.5 py-0.5 rounded">
                        active
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-border">
            <a
              href="/settings?tab=accounts"
              className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add account in Settings
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
