"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerateAnglesDialog } from "./GenerateAnglesDialog";

export function GenerateAnglesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="accent" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        Generate angles
      </Button>
      <GenerateAnglesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
