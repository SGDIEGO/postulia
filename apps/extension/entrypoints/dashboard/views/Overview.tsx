import { useLiveQuery } from "dexie-react-hooks";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowRight,
  faBriefcase,
  faBullseye,
  faCalendarCheck,
  faCircleCheck,
  faComments,
} from "@fortawesome/free-solid-svg-icons";
import {
  SOURCE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatDateEs,
  relativeTimeEs,
} from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { StatusBadge } from "~/components/StatusBadge";
import { Badge, Card, EmptyState, Spinner, cn } from "~/components/ui";
import { useApplications, useReminders } from "~/lib/hooks";
import { computeStats } from "~/lib/stats";
import type { DashboardTab } from "../types";

export function Overview({
  onOpenApplication,
  onGoTo,
}: {
  onOpenApplication: (id: string) => void;
  onGoTo: (tab: DashboardTab) => void;
}) {
  const stats = useLiveQuery(() => computeStats(), [], undefined);
  const applications = useApplications() ?? [];
  const reminders = useReminders({ pendingOnly: true });

  if (!stats) {
    return (
      <div className="p-8">
        <Spinner label="Calculando estadísticas…" />
      </div>
    );
  }

  const maxWeekly = Math.max(1, ...stats.weekly.map((week) => week.count));
  const applicationsById = new Map(
    applications.map((application) => [application.id, application]),
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={faBriefcase}
          label="Postulaciones"
          value={stats.total}
          hint={`${stats.active} en curso`}
          color="#3563f7"
        />
        <Kpi
          icon={faComments}
          label="Entrevistas"
          value={stats.byStatus.interview}
          hint={`${stats.byStatus.screening} en revisión`}
          color="#f59e0b"
        />
        <Kpi
          icon={faCircleCheck}
          label="Ofertas"
          value={stats.byStatus.offer}
          hint={`${(stats.responseRate * 100).toFixed(0)}% de respuesta`}
          color="#10b981"
        />
        <Kpi
          icon={faCalendarCheck}
          label="Recordatorios"
          value={stats.pendingReminders}
          hint="pendientes"
          color="#8b5cf6"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Postulaciones por semana"
          actions={<span className="text-xs text-slate-400">últimas 12 semanas</span>}
          className="lg:col-span-2"
        >
          <div className="flex h-40 items-end gap-1.5">
            {stats.weekly.map((week) => (
              <div key={week.weekStart} className="group flex flex-1 flex-col items-center gap-1">
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600"
                    style={{ height: `${Math.max(4, (week.count / maxWeekly) * 100)}%` }}
                    title={`${week.count} postulaciones`}
                  />
                </div>
                <span className="text-[10px] text-slate-400">
                  {new Date(`${week.weekStart}T00:00:00`).toLocaleDateString("es", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Por portal">
          {stats.bySource.length === 0 ? (
            <p className="text-xs text-slate-400">Aún no hay datos.</p>
          ) : (
            <ul className="space-y-2">
              {stats.bySource
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((entry) => (
                  <li key={entry.source} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 truncate text-slate-600">
                      {SOURCE_LABELS[entry.source]}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(entry.count / Math.max(1, stats.total)) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-xs text-slate-500">{entry.count}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Actividad reciente"
          className="lg:col-span-2"
          actions={
            <button
              type="button"
              onClick={() => onGoTo("applications")}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              Ver todas <FaIcon icon={faArrowRight} size={12} />
            </button>
          }
        >
          {applications.length === 0 ? (
            <EmptyState
              title="Todavía no guardaste postulaciones"
              description="Usa el botón flotante en LinkedIn, Computrabajo o Indeed, o crea una a mano."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {applications.slice(0, 6).map((application) => (
                <li key={application.id}>
                  <button
                    type="button"
                    onClick={() => onOpenApplication(application.id)}
                    className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[application.status] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {application.jobTitle}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {application.company} · {SOURCE_LABELS[application.source]}
                      </span>
                    </span>
                    <span className="hidden text-xs text-slate-400 sm:block">
                      {relativeTimeEs(application.updatedAt)}
                    </span>
                    <StatusBadge status={application.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Próximos seguimientos"
          actions={
            <button
              type="button"
              onClick={() => onGoTo("reminders")}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              Ver todos <FaIcon icon={faArrowRight} size={12} />
            </button>
          }
        >
          {reminders.length === 0 ? (
            <p className="text-xs text-slate-400">No tienes recordatorios pendientes.</p>
          ) : (
            <ul className="space-y-2">
              {reminders.slice(0, 5).map((reminder) => {
                const application = applicationsById.get(reminder.applicationId);
                const overdue = new Date(reminder.dueAt).getTime() < Date.now();
                return (
                  <li key={reminder.id}>
                    <button
                      type="button"
                      onClick={() => application && onOpenApplication(application.id)}
                      className="w-full text-left"
                    >
                      <p className="flex items-center gap-1.5 text-xs">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            overdue ? "bg-rose-500" : "bg-amber-500",
                          )}
                        />
                        <span
                          className={cn(
                            "font-medium",
                            overdue ? "text-rose-600" : "text-slate-700",
                          )}
                        >
                          {formatDateEs(reminder.dueAt)}
                        </span>
                        {overdue && <Badge className="bg-rose-50 text-rose-600">vencido</Badge>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {application
                          ? `${application.company} · ${application.jobTitle}`
                          : "Postulación"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {stats.total === 0 && (
        <Card>
          <div className="flex items-start gap-3">
            <FaIcon icon={faBullseye} className="mt-0.5 text-brand-600" size={18} />
            <div className="text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Primeros pasos</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">
                <li>
                  Abre una oferta en LinkedIn, Computrabajo o Indeed y pulsa “Guardar en Postulia”.
                </li>
                <li>O crea una postulación manual con el botón “Nueva postulación”.</li>
                <li>Configura tu servidor en Ajustes para sincronizar entre dispositivos.</li>
                <li>
                  Puedes mover el estado en el tablero Kanban; los recordatorios se programan según
                  los días configurados.
                </li>
              </ol>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  color,
}: {
  icon: IconDefinition;
  label: string;
  value: number;
  hint: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <FaIcon icon={icon} size={15} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}
