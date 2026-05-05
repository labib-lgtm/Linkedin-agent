import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { type Angle } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("angles")
    .select("*")
    .not("week_assigned", "is", null)
    .order("week_assigned", { ascending: true })
    .order("date_posted", { ascending: true });

  const angles = (data ?? []) as Angle[];
  const groups = new Map<string, Angle[]>();
  for (const a of angles) {
    const k = a.week_assigned ?? "Unscheduled";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
        Calendar
      </h1>
      {error ? (
        <p className="text-sm text-red-700">Failed: {error.message}</p>
      ) : null}

      <div className="space-y-6">
        {[...groups.entries()].map(([week, items]) => (
          <Card key={week}>
            <CardHeader>
              <CardTitle>
                {week}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  · {items.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {items.map((a) => (
                  <Link
                    key={a.angle_id}
                    href={`/angles/${a.angle_id}`}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50"
                  >
                    <span className="font-mono text-xs w-32 shrink-0 text-muted-foreground">
                      {a.angle_id}
                    </span>
                    <span className="text-sm flex-1 truncate">
                      {a.hook_chosen ?? a.hook_seed ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {formatDate(a.date_posted)}
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {groups.size === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No angles have a week assigned yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
