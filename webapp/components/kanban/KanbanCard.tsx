"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Angle } from "@/lib/types";
import { shortDate } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-blue-100 text-blue-800",
  Drafting: "bg-violet-100 text-violet-800",
  Drafted: "bg-violet-100 text-violet-800",
  Visualizing: "bg-fuchsia-100 text-fuchsia-800",
  "Visual Ready": "bg-fuchsia-100 text-fuchsia-800",
  Scheduled: "bg-cyan-100 text-cyan-800",
  Posted: "bg-green-100 text-green-800",
  Reviewed: "bg-stone-200 text-stone-700",
};

export function KanbanCard({ angle }: { angle: Angle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: angle.angle_id, data: { type: "card", angle } });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const headline =
    angle.hook_chosen?.trim() || angle.hook_seed?.trim() || angle.angle_id;
  const formatLabel = angle.format ? angle.format.toUpperCase() : null;

  // Composable statuses open the Post Studio. Posted / Reviewed angles
  // route to the existing detail page since you analyze those, not edit.
  const composable = angle.status === "Approved" || angle.status === "Drafting" || angle.status === "Drafted";
  const href = composable ? `/posts/${angle.angle_id}` : `/angles/${angle.angle_id}`;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link
        href={href}
        className="block rounded-lg border border-border bg-background p-3 hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing"
        draggable={false}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-mono text-muted-foreground">
            {angle.angle_id}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                STATUS_TONE[angle.status] ?? "bg-muted text-muted-foreground"
              }`}
              title={`Status: ${angle.status}`}
            >
              {angle.status}
            </span>
            {formatLabel ? (
              <span className="text-[10px] font-semibold text-muted-foreground tracking-wider">
                {formatLabel}
              </span>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm font-medium leading-snug line-clamp-3">
          {headline}
        </p>
        {angle.cta_keyword ? (
          <div className="mt-2 inline-flex items-center text-[10px] font-bold tracking-wide bg-lynx-green text-lynx-charcoal px-1.5 py-0.5 rounded">
            {angle.cta_keyword}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{angle.pillar ?? "—"}</span>
          <span>{shortDate(angle.date_posted ?? angle.date_approved)}</span>
        </div>
      </Link>
    </div>
  );
}
