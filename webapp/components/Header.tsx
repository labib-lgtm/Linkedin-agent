import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/", label: "Pipeline" },
  { href: "/recipients", label: "Recipients" },
  { href: "/calendar", label: "Calendar" },
  { href: "/angles/new", label: "+ New" },
];

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        </nav>

        <div className="flex items-center gap-3">
          {user?.email ? (
            <>
              <span className="hidden sm:block text-xs text-muted-foreground">
                {user.email}
              </span>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="md:hidden border-t border-border">
        <div className="container-tight flex items-center gap-1 overflow-x-auto py-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-muted"
            >
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
