import { faCalendarCheck, faCheck, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { formatDateEs, relativeTimeEs } from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { EmptyState, Button, cn } from "~/components/ui";
import { useApplications, useReminders } from "~/lib/hooks";
import { deleteReminder, updateReminder } from "~/lib/repository";

export function RemindersView({ onOpenApplication }: { onOpenApplication: (id: string) => void }) {
  const reminders = useReminders();
  const applications = useApplications() ?? [];
  const byId = new Map(applications.map((application) => [application.id, application]));

  const pending = reminders.filter((reminder) => !reminder.done);
  const done = reminders.filter((reminder) => reminder.done);

  const now = Date.now();
  const groups: { title: string; items: typeof reminders; tone: string }[] = [
    {
      title: "Vencidos",
      items: pending.filter((reminder) => new Date(reminder.dueAt).getTime() < now),
      tone: "text-rose-600",
    },
    {
      title: "Próximas 48 horas",
      items: pending.filter((reminder) => {
        const due = new Date(reminder.dueAt).getTime();
        return due >= now && due <= now + 2 * 86_400_000;
      }),
      tone: "text-amber-600",
    },
    {
      title: "Más adelante",
      items: pending.filter(
        (reminder) => new Date(reminder.dueAt).getTime() > now + 2 * 86_400_000,
      ),
      tone: "text-slate-600",
    },
  ];

  return (
    <div className="space-y-4">
      {pending.length === 0 && (
        <EmptyState
          title="Sin recordatorios pendientes"
          description="Al marcar una postulación como postulada se crea un recordatorio automático a los 7 días."
        />
      )}

      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section
              key={group.title}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 className={cn("mb-2 text-sm font-semibold", group.tone)}>
                {group.title}{" "}
                <span className="text-xs font-normal text-slate-400">({group.items.length})</span>
              </h2>
              <ul className="divide-y divide-slate-100">
                {group.items.map((reminder) => {
                  const application = byId.get(reminder.applicationId);
                  return (
                    <li key={reminder.id} className="flex items-center gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => void updateReminder(reminder.id, { done: true })}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                        title="Marcar como hecho"
                      >
                        <FaIcon icon={faCheck} size={12} />
                      </button>

                      <button
                        type="button"
                        onClick={() => application && onOpenApplication(application.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-medium text-slate-800">
                          {application
                            ? `${application.jobTitle} · ${application.company}`
                            : "Postulación"}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {reminder.message ?? "Seguimiento pendiente"}
                        </p>
                      </button>

                      <div className="shrink-0 text-right">
                        <p className="flex items-center gap-1 text-xs text-slate-600">
                          <FaIcon icon={faCalendarCheck} size={12} /> {formatDateEs(reminder.dueAt)}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {relativeTimeEs(reminder.dueAt)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void deleteReminder(reminder.id)}
                        className="shrink-0 text-slate-300 hover:text-rose-500"
                        title="Eliminar"
                      >
                        <FaIcon icon={faTrashCan} size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}

      {done.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-500">
            Completados <span className="text-xs font-normal text-slate-400">({done.length})</span>
          </h2>
          <ul className="divide-y divide-slate-100">
            {done.map((reminder) => {
              const application = byId.get(reminder.applicationId);
              return (
                <li key={reminder.id} className="flex items-center gap-3 py-2 text-slate-400">
                  <button
                    type="button"
                    onClick={() => void updateReminder(reminder.id, { done: false })}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-white"
                    title="Marcar como pendiente"
                  >
                    <FaIcon icon={faCheck} size={12} />
                  </button>
                  <p className="min-w-0 flex-1 truncate text-sm line-through">
                    {application
                      ? `${application.jobTitle} · ${application.company}`
                      : "Postulación"}
                  </p>
                  <p className="shrink-0 text-xs">{formatDateEs(reminder.dueAt)}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void updateReminder(reminder.id, { done: false })}
                  >
                    Reabrir
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
