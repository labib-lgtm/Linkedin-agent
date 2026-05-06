"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_LABELS: Record<string, string> = {
  direct: "Direct competitor",
  format_source: "Format source",
  topic_source: "Topic source",
};

export function AddCompetitorForm() {
  const router = useRouter();
  const [profileUrl, setProfileUrl] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("direct");
  const [submitting, setSubmitting] = useState(false);

  async function add() {
    if (!profileUrl.trim()) {
      toast.error("LinkedIn profile URL is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_url: profileUrl,
          display_name: name,
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      toast.success(`Added ${data.competitor.identifier}`);
      setProfileUrl("");
      setName("");
      router.refresh();
    } catch (e) {
      toast.error(`Add failed: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add competitor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="profile-url">LinkedIn profile URL</Label>
          <Input
            id="profile-url"
            placeholder="https://www.linkedin.com/in/..."
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="name">Display name (optional)</Label>
            <Input
              id="name"
              placeholder="Elizabeth Greene"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <Button onClick={add} disabled={submitting} variant="accent">
            {submitting ? "Adding..." : "Add competitor"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
