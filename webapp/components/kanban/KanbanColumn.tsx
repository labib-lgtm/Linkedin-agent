"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type Angle } from "@/lib/types";
import { type StageId } from "@/lib/constants";
import { KanbanCard } from "./KanbanCard";

export function KanbanColumn({
  stageId,
  label,
  items,
}: {
  stageId: StageId;
  label: string;
  items: Angle[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stageId,
    data: { type: "stage", stageId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg p-3 transition-colors min-h-[160px] ${
        isOver ? "bg-lynx-green/15 ring-2 ring-lynx-green/40" : "bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="font-heading text-sm font-semibold tracking-wide uppercase">
          {label}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <SortableContext
        items={items.map((a) => a.angle_id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 min-h-[40px]">
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-1 py-4 text-center">
              Nothing here yet
            </div>
          ) : (
            items.map((a) => <KanbanCard key={a.angle_id} angle={a} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}
