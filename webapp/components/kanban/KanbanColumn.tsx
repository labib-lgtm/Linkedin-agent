"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type Angle } from "@/lib/types";
import { type Status } from "@/lib/constants";
import { KanbanCard } from "./KanbanCard";

export function KanbanColumn({
  status,
  items,
}: {
  status: Status;
  items: Angle[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: "column", status },
  });

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 w-72 sm:w-80 rounded-lg p-3 transition-colors ${
        isOver ? "bg-lynx-green/15 ring-2 ring-lynx-green/40" : "bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="font-heading text-sm font-semibold tracking-wide uppercase">
          {status}
        </h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
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
