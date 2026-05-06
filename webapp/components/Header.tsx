"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { AccountSwitcher } from "@/components/AccountSwitcher";

const NAV = [
  { href: "/book", label: "Book" },
  { href: "/", label: "Pipeline" },
  { href: "/competitors", label: "Competitors" },
  { href: "/digest", label: "Digest" },
  { href: "/recipients", label: "Recipients" },
  { href: "/calendar", label: "Calendar" },
  { href: "/settings", label: "Settings" },
  { href: "/angles/new", label: "+ New" },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/lock") return null;

  async function lock() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/lock");
    router.refresh();
  }

  return (
    <header className="border-b border-border bg-background">
      <div className="container-tight flex h-14 items-center justify-between gap-4">
        <Link
          href="/"
          className="font-heading text-lg font-bold tracking-tight text-lynx-charcoal"
        >
          <span className="rounded bg-lynx-green px-1.5 py-0.5">Lynx</span>{" "}
          LinkedIn Agent
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="px-3 py-1.5 rounded-md text-sm font-medium hover:bg-muted"
            >
              {n.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={lock}
            title="Lock app"
            className="ml-1 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground"
          >
            <Lock className="h-4 w-4 inline" />
          </button>
          <div className="ml-2 pl-2 border-l border-border">
            <AccountSwitcher />
          </div>
        </nav>
      </div>

      {/* Mobile nav */}
      <nav className="md:hidden border-t border-border">
        <div className="container-tight flex items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-muted"
              >
                {n.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={lock}
              className="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground"
            >
              <Lock className="h-4 w-4 inline" />
            </button>
          </div>
          <AccountSwitcher />
        </div>
      </nav>
    </header>
  );
}
