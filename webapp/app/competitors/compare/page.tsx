import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { CompareGrid } from "@/components/competitors/CompareGrid";

export const dynamic = "force-dynamic";

type SearchParams = { ids?: string };

type CompetitorMeta = {
  id: string;
  identifier: string;
  display_name: string | null;
  role: string;
  last_analyzed_at: string | null;
  active: boolean;
};

export default async function CompetitorCompare({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = createServiceClient();

  const { data: allCompetitors, error } = await supabase
    .from("competitors")
    .select("id, identifier, display_name, role, last_analyzed_at, active")
    .order("added_at", { ascending: true });

  if (error) {
    return (
      <div className="container-tight py-8">
        <h1 className="font-heading text-2xl font-bold">Compare</h1>
        <p className="mt-4 text-sm text-red-700">Failed to load: {error.message}</p>
      </div>
    );
  }

  const allActive = (allCompetitors ?? []).filter((c: CompetitorMeta) => c.active);

  if (allActive.length === 0) {
    return (
      <div className="container-tight py-8 space-y-4">
        <h1 className="font-heading text-2xl font-bold">Compare</h1>
        <p className="text-sm text-muted-foreground">
          No active competitors yet. Add some in{" "}
          <Link href="/competitors" className="underline">
            /competitors
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  // Default state: all active selected. Redirect to make the URL the source
  // of truth — toggling on the client just rewrites query params.
  if (!sp.ids) {
    const all = allActive.map((c) => c.id).join(",");
    redirect(`/competitors/compare?ids=${all}`);
  }

  const selectedIds = (sp.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Compare competitors
          </h1>
          <p className="text-xs text-muted-foreground">
            Toggle competitors on / off. URL updates so the view is bookmarkable.
          </p>
        </div>
      </div>
      <CompareGrid allCompetitors={allActive} initialSelectedIds={selectedIds} />
    </div>
  );
}
