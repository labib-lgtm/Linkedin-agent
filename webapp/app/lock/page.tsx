import { Suspense } from "react";
import { LockForm } from "./LockForm";

// Next.js 15 requires any client component using useSearchParams() to be
// wrapped in a Suspense boundary so the surrounding page can be prerendered.
// LockForm reads ?next=... — keep it as the client child.
export default function LockPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      }
    >
      <LockForm />
    </Suspense>
  );
}
