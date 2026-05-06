import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { PostStudio } from "./PostStudio";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

// Phase A of Post Studio. The right pane (slide editor) is a placeholder
// until Phase B; this page handles the copy half end-to-end: 5 hook
// variants, role-tagged body editor, CTA archetype + copy, pin comment.

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

      <PostStudio initialAngle={angle} />
    </div>
  );
}
