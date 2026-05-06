import { createServiceClient } from "@/lib/supabase/server";
import { KANBAN_STATUSES, type Status } from "@/lib/constants";
import { type Angle } from "@/lib/types";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { KanbanFilters } from "@/components/kanban/KanbanFilters";
import { GenerateAnglesButton } from "@/components/kanban/GenerateAnglesButton";

export const dynamic = "force-dynamic";

type SearchParams = {
  pillar?: string;
  format?: string;
  week?: string;
};

export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();

  let query = supabase.from("angles").select("*").order("created_at", {
    ascending: false,
  });
  if (sp.pillar) query = query.eq("pillar", sp.pillar);
  if (sp.format) query = query.eq("format", sp.format);
  if (sp.week) query = query.eq("week_assigned", sp.week);

  const { data, error } = await query;

  if (error) {
    return (
      <div className="container-tight py-8">
        <h1 className="font-heading text-2xl font-bold">Pipeline</h1>
        <p className="mt-4 text-sm text-red-700">
          Failed to load angles: {error.message}
        </p>
      </div>
    );
  }

  const angles = (data ?? []) as Angle[];
  const grouped: Record<Status, Angle[]> = Object.fromEntries(
    KANBAN_STATUSES.map((s) => [s, [] as Angle[]]),
  ) as Record<Status, Angle[]>;
  for (const a of angles) {
    if (a.status in grouped) grouped[a.status].push(a);
  }

  return (
    <div className="container-tight py-6 sm:py-8">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Pipeline
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {angles.length} total
          </span>
          <GenerateAnglesButton />
        </div>
      </div>

      <div className="mb-6">
        <KanbanFilters />
      </div>

      <KanbanBoard initial={grouped} />
    </div>
  );
}
