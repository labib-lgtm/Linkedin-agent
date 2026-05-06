"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Angle } from "@/lib/types";
import { shortDate } from "@/lib/utils";

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

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link
        href={`/angles/${angle.angle_id}`}
        className="block rounded-lg border border-border bg-background p-3 hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing"
        draggable={false}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-mono text-muted-foreground">
            {angle.angle_id}
          </div>
          {formatLabel ? (
            <span className="text-[10px] font-semibold text-muted-foreground tracking-wider">
              {formatLabel}
            </span>
          ) : null}
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
