import { AudienceTabs } from "./AudienceTabs";

export const dynamic = "force-dynamic";

export default function AudiencePage() {
  return (
    <div className="container-tight py-6 sm:py-8 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Audience
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Who you have vs. who you want. Connections, followers, outbound requests, target
            segments, and competitor engagers — all in one view.
          </p>
        </div>
      </div>
      <AudienceTabs />
    </div>
  );
}
