"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  KanbanSquare,
  Users,
  Send,
  Building2,
  Newspaper,
  BarChart3,
  Inbox,
  Calendar,
  Settings as SettingsIcon,
  PlusCircle,
  Lock,
  Menu,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher } from "@/components/AccountSwitcher";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { href: "/book", label: "Book", icon: BookOpen },
  { href: "/", label: "Pipeline", icon: KanbanSquare },
  { href: "/competitors", label: "Competitors", icon: Users },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/prospects", label: "Prospects", icon: Building2 },
  { href: "/digest", label: "Digest", icon: Newspaper },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/recipients", label: "Recipients", icon: Inbox },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const NEW_ITEM: NavItem = { href: "/angles/new", label: "+ New angle", icon: PlusCircle };

const COLLAPSED_KEY = "lynx_sidebar_collapsed";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read collapsed preference from localStorage on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(COLLAPSED_KEY);
      if (v === "1") setCollapsed(true);
    } catch {
      // No-op — localStorage may be unavailable.
    }
    setHydrated(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // No-op.
      }
      return next;
    });
  }

  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function lock() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/lock");
    router.refresh();
  }

  if (pathname === "/lock") return null;

  const width = collapsed ? "md:w-16" : "md:w-60";

  return (
    <>
      {/* Mobile top bar (visible on small screens only) */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-background">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="p-1.5 rounded hover:bg-muted"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link
          href="/"
          className="font-heading text-base font-bold tracking-tight text-lynx-charcoal"
        >
          <span className="rounded bg-lynx-green px-1.5 py-0.5 text-sm">Lynx</span>{" "}
          LinkedIn Agent
        </Link>
        <AccountSwitcher />
      </div>

      {/* Mobile drawer backdrop */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/40 cursor-pointer"
        />
      ) : null}

      {/* Sidebar — fixed-position, full height. Desktop visible, mobile drawer. */}
      <aside
        className={[
          "fixed z-50 top-0 left-0 h-screen border-r border-border bg-background flex flex-col transition-[width,transform] duration-200",
          // Desktop width (driven by collapsed state, only when hydrated)
          hydrated ? width : "md:w-60",
          // Mobile drawer behavior
          "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        {/* Logo block */}
        <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-border min-h-14">
          <Link
            href="/"
            className="font-heading font-bold tracking-tight text-lynx-charcoal flex items-center gap-1.5 min-w-0"
            title="Lynx LinkedIn Agent"
          >
            <span className="rounded bg-lynx-green px-1.5 py-0.5 text-base shrink-0">Lynx</span>
            {!collapsed ? (
              <span className="text-sm truncate">LinkedIn Agent</span>
            ) : null}
          </Link>
          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:block p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {NAV.map((n) => (
            <NavRow key={n.href} item={n} active={isActive(pathname, n.href)} collapsed={collapsed} />
          ))}
          <div className="pt-2 mt-2 border-t border-border">
            <NavRow item={NEW_ITEM} active={isActive(pathname, NEW_ITEM.href)} collapsed={collapsed} highlight />
          </div>
        </nav>

        {/* Footer: account switcher + lock */}
        <div className="border-t border-border p-2 space-y-1">
          {!collapsed ? (
            <div className="px-1 pb-1">
              <AccountSwitcher />
            </div>
          ) : null}
          <button
            type="button"
            onClick={lock}
            title="Lock app"
            className={[
              "w-full flex items-center gap-2 px-2 py-2 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted",
              collapsed ? "justify-center" : "",
            ].join(" ")}
          >
            <Lock className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>Lock</span> : null}
          </button>
        </div>
      </aside>

      {/* Content offset spacer — pushes <main> over by sidebar width on desktop. */}
      <div
        className={[
          "hidden md:block shrink-0 transition-[width] duration-200",
          hydrated && collapsed ? "md:w-16" : "md:w-60",
        ].join(" ")}
        aria-hidden
      />
    </>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  highlight,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  highlight?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-lynx-green text-lynx-charcoal"
          : highlight
            ? "text-lynx-charcoal bg-lynx-green/20 hover:bg-lynx-green/30"
            : "text-foreground/80 hover:bg-muted hover:text-foreground",
        collapsed ? "justify-center" : "",
      ].join(" ")}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );
}
