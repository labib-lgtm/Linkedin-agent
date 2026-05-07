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
import { STAGES, stageForStatus, type StageId, type Status } from "@/lib/constants";
import { type Angle } from "@/lib/types";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";

type Grouped = Record<StageId, Angle[]>;

const STAGE_IDS = STAGES.map((s) => s.id) as readonly StageId[];

function findStage(grouped: Grouped, id: string): StageId | null {
  if ((STAGE_IDS as readonly string[]).includes(id)) return id as StageId;
  for (const stage of STAGE_IDS) {
    if (grouped[stage].some((a) => a.angle_id === id)) return stage;
  }
  return null;
}

function landingStatusForStage(stageId: StageId): Status {
  return STAGES.find((s) => s.id === stageId)!.landingStatus;
}

export function KanbanBoard({ initial }: { initial: Grouped }) {
  const [grouped, setGrouped] = useState<Grouped>(initial);
  const [activeAngle, setActiveAngle] = useState<Angle | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const stage = findStage(grouped, id);
    if (!stage) return;
    const angle = grouped[stage].find((a) => a.angle_id === id) ?? null;
    setActiveAngle(angle);
  }

  function onDragOver(e: DragOverEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    const fromStage = findStage(grouped, activeId);
    const toStage = findStage(grouped, overId);
    if (!fromStage || !toStage || fromStage === toStage) return;

    const newStatus = landingStatusForStage(toStage);

    setGrouped((prev) => {
      const next: Grouped = { ...prev };
      const sourceItems = [...prev[fromStage]];
      const movingIdx = sourceItems.findIndex((a) => a.angle_id === activeId);
      if (movingIdx === -1) return prev;
      const [moving] = sourceItems.splice(movingIdx, 1);
      next[fromStage] = sourceItems;
      next[toStage] = [{ ...moving, status: newStatus }, ...prev[toStage]];
      return next;
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    setActiveAngle(null);
    if (!overId) return;

    const targetStage = findStage(grouped, overId);
    if (!targetStage) return;

    // Same-stage reorder is local-only. Cross-stage = status change → persist.
    const originalStage = stageForStatus(
      Object.values(initial)
        .flat()
        .find((a) => a.angle_id === activeId)?.status ?? ("Pending" as Status),
    );
    if (originalStage === targetStage) return;

    const newStatus = landingStatusForStage(targetStage);
    const snapshot = JSON.parse(JSON.stringify(grouped)) as Grouped;
    try {
      const res = await fetch(`/api/angles/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Moved ${activeId} → ${newStatus}`);
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
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stageId={stage.id}
            label={stage.label}
            items={grouped[stage.id] ?? []}
          />
        ))}
      </div>
      <DragOverlay>
        {activeAngle ? <KanbanCard angle={activeAngle} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
