"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { KANBAN_STATUSES, type Status } from "@/lib/constants";
import { type Angle } from "@/lib/types";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";

type Grouped = Record<Status, Angle[]>;

function findColumn(grouped: Grouped, id: string): Status | null {
  // id can be a column id (status) or a card id (angle_id).
  if ((KANBAN_STATUSES as readonly string[]).includes(id)) return id as Status;
  for (const status of KANBAN_STATUSES) {
    if (grouped[status].some((a) => a.angle_id === id)) return status;
  }
  return null;
}

export function KanbanBoard({ initial }: { initial: Grouped }) {
  const [grouped, setGrouped] = useState<Grouped>(initial);
  const [activeAngle, setActiveAngle] = useState<Angle | null>(null);

  // distance:5 prevents accidental drags when clicking the link inside the card.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const col = findColumn(grouped, id);
    if (!col) return;
    const angle = grouped[col].find((a) => a.angle_id === id) ?? null;
    setActiveAngle(angle);
  }

  function onDragOver(e: DragOverEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    const fromCol = findColumn(grouped, activeId);
    const toCol = findColumn(grouped, overId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    setGrouped((prev) => {
      const next: Grouped = { ...prev };
      const sourceItems = [...prev[fromCol]];
      const movingIdx = sourceItems.findIndex((a) => a.angle_id === activeId);
      if (movingIdx === -1) return prev;
      const [moving] = sourceItems.splice(movingIdx, 1);
      next[fromCol] = sourceItems;
      next[toCol] = [{ ...moving, status: toCol }, ...prev[toCol]];
      return next;
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    setActiveAngle(null);
    if (!overId) return;

    const targetCol = findColumn(grouped, overId);
    if (!targetCol) return;

    const angle = grouped[targetCol].find((a) => a.angle_id === activeId);
    if (!angle) return;

    // Same-column reorder is local-only for now (we don't track per-card order
    // in Supabase). Cross-column = status change → persist.
    const originalCol = initial[targetCol].some((a) => a.angle_id === activeId)
      ? targetCol
      : (Object.entries(initial).find(([, list]) =>
          list.some((a) => a.angle_id === activeId),
        )?.[0] as Status | undefined);

    if (originalCol === targetCol) return;

    const snapshot = JSON.parse(JSON.stringify(grouped)) as Grouped;
    try {
      const res = await fetch(`/api/angles/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetCol }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Moved ${activeId} to ${targetCol}`);
    } catch (err) {
      setGrouped(snapshot);
      toast.error(`Failed to move ${activeId}: ${(err as Error).message}`);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {KANBAN_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            items={grouped[status]}
          />
        ))}
      </div>
      <DragOverlay>
        {activeAngle ? <KanbanCard angle={activeAngle} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
