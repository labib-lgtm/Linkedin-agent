"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Stage-1 placeholder. The actual generate flow ships in Stage 2 once
// /api/angles/generate and the dialog land.
export function GenerateAnglesButton() {
  return (
    <Button
      variant="accent"
      size="sm"
      onClick={() => toast.info("Angle generation arrives in Stage 2")}
    >
      <Sparkles className="h-4 w-4" />
      Generate angles
    </Button>
  );
}
