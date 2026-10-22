import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  KANBAN_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  type ApplicationStatus,
} from "@postulia/shared";
import { StatusBadge } from "~/components/StatusBadge";
import { EmptyState, cn } from "~/components/ui";
import { useApplications } from "~/lib/hooks";
import { changeStatus } from "~/lib/repository";
import { daysBetween } from "@postulia/shared";

export function KanbanView({ onOpenApplication }: { onOpenApplication: (id: string) => void }) {
  const applications = useApplications();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const list = applications ?? [];

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const status = over.id as ApplicationStatus;
    if (!KANBAN_STATUSES.includes(status)) return;

    const application = list.find((item) => item.id === String(active.id));
    if (!application || application.status === status) return;
    void changeStatus(application.id, status);
  }

  if (applications && applications.length === 0) {
    return (
      <EmptyState
        title="Tu tablero está vacío"
        description="Guarda ofertas desde el navegador o crea una postulación para verla aquí."
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {KANBAN_STATUSES.map((status) => {
          const items = list
            .filter((application) => application.status === status)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

          return (
            <Column
              key={status}
              status={status}
              count={items.length}
              isDragging={Boolean(activeId)}
            >
              {items.map((application) => (
                <Card
                  key={application.id}
                  id={application.id}
                  title={application.jobTitle}
                  company={application.company}
                  tags={application.tags}
                  days={
                    application.appliedAt ? daysBetween(application.appliedAt, new Date()) : null
                  }
                  onClick={() => onOpenApplication(application.id)}
                />
              ))}

              {items.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 px-2 py-6 text-center text-xs text-slate-400">
                  Suelta aquí
                </p>
              )}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  count,
  isDragging,
  children,
}: {
  status: ApplicationStatus;
  count: number;
  isDragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border bg-slate-100/60 p-2 transition",
        isOver ? "border-brand-400 bg-brand-50" : "border-slate-200",
      )}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[status] }}
          />
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-white px-1.5 text-[10px] font-medium text-slate-500">
          {count}
        </span>
      </header>

      <div className={cn("flex flex-1 flex-col gap-2", isDragging && "min-h-16")}>{children}</div>
    </div>
  );
}

function Card({
  id,
  title,
  company,
  tags,
  days,
  onClick,
}: {
  id: string;
  title: string;
  company: string;
  tags: string[];
  days: number | null;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              zIndex: 50,
            }
          : undefined
      }
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        "cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-brand-300",
        isDragging && "cursor-grabbing opacity-70 shadow-lg",
      )}
    >
      <p className="line-clamp-2 text-xs font-semibold text-slate-800">{title}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{company}</p>

      <div className="mt-1.5 flex items-center justify-between gap-1">
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {tag}
            </span>
          ))}
        </div>
        {days !== null && (
          <span className="shrink-0 text-[10px] text-slate-400">
            {days <= 0 ? "hoy" : `hace ${days} ${days === 1 ? "día" : "días"}`}
          </span>
        )}
      </div>
    </div>
  );
}
