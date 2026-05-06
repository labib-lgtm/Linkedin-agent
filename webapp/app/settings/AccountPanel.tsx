"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AccountPanel() {
  return (
    <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>App lock</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The app is gated by a 4-digit PIN. Rotate it by changing the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">APP_PIN</code>
            env var in Vercel and redeploying. UI-side rotation arrives with
            Stage 2.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Sessions last 30 days, signed with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">SESSION_SECRET</code>.
            Rotating the secret signs out all active sessions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
