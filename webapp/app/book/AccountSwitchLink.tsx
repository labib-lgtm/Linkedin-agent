"use client";

import { useState } from "react";

// Click a row in the Book table → switch active account → redirect to
// /competitors. Lives in its own client component so the surrounding
// Book page can stay a server component.
export function AccountSwitchLink({
  accountId,
  children,
}: {
  accountId: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await fetch("/api/accounts/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      window.location.href = "/competitors";
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="flex items-center gap-3 cursor-pointer text-left disabled:opacity-60"
    >
      {children}
    </button>
  );
}
