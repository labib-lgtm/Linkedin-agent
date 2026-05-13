import { ProspectsView } from "./ProspectsView";

export const dynamic = "force-dynamic";

// Server entry — the client component owns its own fetches because it
// needs to refetch on import status changes anyway. Keeping this thin
// avoids a server-side join that would just get re-fetched 5 sec later.
export default async function ProspectsPage() {
  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Prospects
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Amazon seller CSV → LinkedIn match. Each company surfaces ~5 featured
            employees. Review, then manually DM via the existing engagement flow.
          </p>
        </div>
      </div>
      <ProspectsView />
    </div>
  );
}
