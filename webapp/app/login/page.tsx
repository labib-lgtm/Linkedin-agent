"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const supabase = createClient();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="font-heading text-xl font-bold tracking-tight">
            <span className="rounded bg-lynx-green px-1.5 py-0.5">Lynx</span>{" "}
            LinkedIn Agent
          </div>
          <CardTitle className="mt-4">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="labib@lynxmedia.co"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "sending" || status === "sent"}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              variant="accent"
              disabled={status === "sending" || status === "sent"}
            >
              {status === "sending" ? "Sending..." : "Send magic link"}
            </Button>
            {status === "sent" ? (
              <p className="text-sm text-emerald-700">
                Check your email — we sent a sign-in link to <b>{email}</b>.
              </p>
            ) : null}
            {status === "error" ? (
              <p className="text-sm text-red-700">{errorMsg}</p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
