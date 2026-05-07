import { OutreachQueue } from "./OutreachQueue";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  return (
    <div className="container-tight py-6 sm:py-8 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Outreach
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-drafted comments on competitor posts. Approve to queue, the bot posts at most
            5/day per account with mandatory 2h gaps.
          </p>
        </div>
      </div>
      <OutreachQueue />
    </div>
  );
}
