"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  PILLAR_VALUES,
  FORMAT_VALUES,
  type Pillar,
  type FormatValue,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

type FilterKey = "pillar" | "format" | "week";

export function KanbanFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const current = {
    pillar: params.get("pillar") ?? "",
    format: params.get("format") ?? "",
    week: params.get("week") ?? "",
  };

  function set(key: FilterKey, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === current[key]) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : "/");
  }

  function clearAll() {
    router.replace("/");
  }

  const hasAny = Object.values(current).some(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <FilterGroup label="Pillar">
        {PILLAR_VALUES.map((p) => (
          <Pill
            key={p}
            active={current.pillar === p}
            onClick={() => set("pillar", p)}
          >
            {p}
          </Pill>
        ))}
      </FilterGroup>
      <FilterGroup label="Format">
        {FORMAT_VALUES.map((f) => (
          <Pill
            key={f}
            active={current.format === f}
            onClick={() => set("format", f)}
          >
            {f}
          </Pill>
        ))}
      </FilterGroup>
      <FilterGroup label="Week">
        <input
          type="text"
          placeholder="e.g. 2026-W19"
          value={current.week}
          onChange={(e) => set("week", e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </FilterGroup>
      {hasAny ? (
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto text-muted-foreground underline-offset-2 hover:underline"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 transition-colors",
        active
          ? "bg-lynx-charcoal text-white"
          : "bg-muted text-foreground hover:bg-muted/70",
      )}
    >
      {children}
    </button>
  );
}

export type { Pillar, FormatValue };
