import { createServiceClient } from "@/lib/supabase/server";
import { AngleCard } from "@/components/AngleCard";
import { KANBAN_STATUSES, type Status } from "@/lib/constants";
import { type Angle } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("angles")
    .select("*")
    .order("created_at", { ascending: false });

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Pipeline
        </h1>
        <div className="text-xs text-muted-foreground">
          {angles.length} total
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {KANBAN_STATUSES.map((status) => (
          <div
            key={status}
            className="shrink-0 w-72 sm:w-80 bg-muted/40 rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="font-heading text-sm font-semibold tracking-wide uppercase">
                {status}
              </h2>
              <span className="text-xs text-muted-foreground">
                {grouped[status].length}
              </span>
            </div>
            <div className="space-y-2">
              {grouped[status].length === 0 ? (
                <div className="text-xs text-muted-foreground italic px-1 py-4 text-center">
                  Nothing here yet
                </div>
              ) : (
                grouped[status].map((a) => (
                  <AngleCard key={a.angle_id} angle={a} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
