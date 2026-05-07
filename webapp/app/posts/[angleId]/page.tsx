import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { PostStudio } from "./PostStudio";
import { StatusBadge } from "@/components/StatusBadge";
import type { Palette } from "@/components/posts/SlideCard";

export const dynamic = "force-dynamic";

// Phase A + B of Post Studio. Left pane: copy editor (5 hooks, body,
// CTA, pin). Right pane: slide editor for carousel angles, otherwise a
// placeholder. Phase C/D land coherence + image gen on top of this.

const DEFAULT_PALETTE: Palette = {
  primary: "#C6F21F",
  secondary: "#666666",
  accent: "#b8543c",
  ink: "#0e0e0e",
  paper: "#fafafa",
};

export default async function PostStudioPage({
  params,
}: {
  params: Promise<{ angleId: string }>;
}) {
  const { angleId } = await params;
  const supabase = createServiceClient();

  const { data: angle, error } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();

  if (error || !angle) notFound();

  let palette = DEFAULT_PALETTE;
  if (angle.account_id) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("brand_palette, brand_color")
      .eq("id", angle.account_id)
      .maybeSingle();
    if (acct?.brand_palette && typeof acct.brand_palette === "object") {
      palette = { ...DEFAULT_PALETTE, ...(acct.brand_palette as Palette) };
    } else if (typeof acct?.brand_color === "string") {
      palette = { ...DEFAULT_PALETTE, primary: acct.brand_color };
    }
  }

  return (
    <div className="container-tight py-4 sm:py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/" className="hover:underline">
            ← Pipeline
          </Link>
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted">
            {angle.angle_id}
          </span>
          <StatusBadge status={angle.status} />
          {angle.pillar ? (
            <span className="text-xs px-2 py-0.5 rounded bg-muted">
              {angle.pillar}
            </span>
          ) : null}
          {angle.format ? (
            <span className="text-xs px-2 py-0.5 rounded bg-muted uppercase tracking-wider">
              {angle.format}
            </span>
          ) : null}
        </div>
      </div>

      <PostStudio initialAngle={angle} brandPalette={palette} />
    </div>
  );
}
