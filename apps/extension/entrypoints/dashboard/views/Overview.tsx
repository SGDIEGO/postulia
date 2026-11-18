import { useLiveQuery } from "dexie-react-hooks";
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
  formatDateEs,
  relativeTimeEs,
} from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Badge,
  Card,
  EmptyState,
  KpiCard,
  Skeleton,
  SkeletonList,
  cn,
} from "~/components/ui";
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
  const applications = useApplications();
  const reminders = useReminders({ pendingOnly: true });

  if (!stats) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <SkeletonList rows={3} />
      </div>
    );
  }

  const maxWeekly = Math.max(1, ...stats.weekly.map((week) => week.count));
  const applicationsById = new Map((applications ?? []).map((item) => [item.id, item]));
  const responseRate = Math.round(stats.responseRate * 100);
  const interviewRate = stats.total
    ? Math.round(((stats.byStatus.interview + stats.byStatus.offer) / stats.total) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={faBriefcase}
          label="Postulaciones"
          value={stats.total}
          hint={`${stats.active} en curso`}
          tone="brand"
        />
        <KpiCard
          icon={faComments}
          label="Entrevistas"
          value={stats.byStatus.interview}
          hint={`${interviewRate}% del total`}
          tone="amber"
        />
        <KpiCard
          icon={faCircleCheck}
          label="Ofertas"
          value={stats.byStatus.offer}
          hint={`${responseRate}% de respuesta`}
          tone="emerald"
        />
        <KpiCard
          icon={faCalendarCheck}
          label="Recordatorios"
          value={stats.pendingReminders}
          hint="pendientes"
          tone="violet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Postulaciones por semana"
          description="Últimas 12 semanas"
          className="lg:col-span-2"
        >
          <div className="flex h-40 items-end gap-1.5">
            {stats.weekly.map((week) => (
              <div key={week.weekStart} className="group flex flex-1 flex-col items-center gap-1">
                <div className="relative flex w-full flex-1 items-end">
                  {/* Altura en píxeles: los porcentajes no resuelven dentro de un
                      flex item sin altura definida y las barras quedaban a 0. */}
                  <div
                    className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600"
                    style={{ height: `${Math.max(6, (week.count / maxWeekly) * 128)}px` }}
                    title={`${week.count} postulaciones`}
                  />
                </div>
                <span className="text-label text-ink-subtle">
                  {new Date(`${week.weekStart}T00:00:00`).toLocaleDateString("es", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Por portal" description="Reparto de tus postulaciones">
          {stats.bySource.length === 0 ? (
            <p className="text-label text-ink-subtle">Aún no hay datos.</p>
          ) : (
            <ul className="space-y-2">
              {stats.bySource
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((entry) => {
                  const share = Math.round((entry.count / Math.max(1, stats.total)) * 100);
                  return (
                    <li key={entry.source} className="flex items-center gap-2 text-title">
                      <span className="w-24 shrink-0 truncate text-label text-ink-soft">
                        {SOURCE_LABELS[entry.source]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-label text-ink-muted">
                        {entry.count} · {share}%
                      </span>
                    </li>
                  );
                })}
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
              className="inline-flex min-h-8 items-center gap-1 text-label font-medium text-brand-600 hover:underline"
            >
              Ver todas <FaIcon icon={faArrowRight} size={12} />
            </button>
          }
        >
          {applications === undefined ? (
            <SkeletonList rows={4} />
          ) : applications.length === 0 ? (
            <EmptyState
              title="Todavía no guardaste postulaciones"
              description="Usa el botón flotante en LinkedIn, Computrabajo o Indeed, o crea una a mano."
            />
          ) : (
            <ul className="divide-y divide-line">
              {applications.slice(0, 6).map((application) => (
                <li key={application.id}>
                  <button
                    type="button"
                    onClick={() => onOpenApplication(application.id)}
                    className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-surface-muted"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[application.status] }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-title font-medium text-ink">
                        {application.jobTitle}
                      </span>
                      <span className="block truncate text-label text-ink-muted">
                        {application.company} · {SOURCE_LABELS[application.source]}
                      </span>
                    </span>
                    <span className="hidden text-label text-ink-subtle sm:block">
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
              className="inline-flex min-h-8 items-center gap-1 text-label font-medium text-brand-600 hover:underline"
            >
              Ver todos <FaIcon icon={faArrowRight} size={12} />
            </button>
          }
        >
          {reminders.length === 0 ? (
            <p className="text-label text-ink-subtle">No tienes recordatorios pendientes.</p>
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
                      className="w-full rounded-control text-left"
                    >
                      <p className="flex items-center gap-1.5 text-label">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            overdue ? "bg-rose-500" : "bg-amber-500",
                          )}
                        />
                        <span
                          className={cn("font-medium", overdue ? "text-danger" : "text-ink-soft")}
                        >
                          {formatDateEs(reminder.dueAt)}
                        </span>
                        {overdue && <Badge className="bg-danger-soft text-danger">vencido</Badge>}
                      </p>
                      <p className="truncate text-label text-ink-muted">
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
            <div className="text-body text-ink-soft">
              <p className="text-title font-semibold text-ink">Primeros pasos</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-label">
                <li>
                  Abre una oferta en LinkedIn, Computrabajo o Indeed y pulsa “Guardar en Postulia”.
                </li>
                <li>O crea una postulación manual con el botón “Nueva postulación”.</li>
                <li>Tus datos se guardan en este navegador; puedes exportarlos desde Ajustes.</li>
                <li>
                  Puedes mover el estado en el tablero Kanban; los recordatorios se programan al
                  postular.
                </li>
              </ol>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
