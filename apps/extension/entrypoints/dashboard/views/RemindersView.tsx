import { useState } from "react";
import { faCalendarCheck, faCheck, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { formatDateEs, relativeTimeEs } from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { Button, ConfirmDialog, EmptyState, IconButton, Skeleton, cn } from "~/components/ui";
import { useToast } from "~/components/Toast";
import { useApplications, useReminders } from "~/lib/hooks";
import { deleteReminder, updateReminder } from "~/lib/repository";

export function RemindersView({ onOpenApplication }: { onOpenApplication: (id: string) => void }) {
  const reminders = useReminders();
  const applications = useApplications() ?? [];
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const byId = new Map(applications.map((application) => [application.id, application]));

  if (reminders === undefined) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const pending = reminders.filter((reminder) => !reminder.done);
  const done = reminders.filter((reminder) => reminder.done);

  const now = Date.now();
  const groups: {
    title: string;
    items: typeof reminders;
    tone: string;
  }[] = [
    {
      title: "Vencidos",
      items: pending.filter((reminder) => new Date(reminder.dueAt).getTime() < now),
      tone: "text-danger",
    },
    {
      title: "Próximas 48 horas",
      items: pending.filter((reminder) => {
        const due = new Date(reminder.dueAt).getTime();
        return due >= now && due <= now + 2 * 86_400_000;
      }),
      tone: "text-warning",
    },
    {
      title: "Más adelante",
      items: pending.filter((reminder) => new Date(reminder.dueAt).getTime() > now + 2 * 86_400_000),
      tone: "text-ink-soft",
    },
  ];

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteReminder(pendingDelete);
      toast({ title: "Recordatorio eliminado", tone: "success" });
    } catch (error) {
      toast({
        title: "No se pudo eliminar",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  async function toggleDone(id: string, done: boolean) {
    try {
      await updateReminder(id, { done });
    } catch (error) {
      toast({
        title: "No se pudo actualizar el recordatorio",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    }
  }

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
              className="rounded-card border border-line bg-surface p-4 shadow-card"
            >
              <h2 className={cn("mb-2 text-title font-semibold", group.tone)}>
                {group.title}{" "}
                <span className="text-label font-normal text-ink-subtle">
                  ({group.items.length})
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {group.items.map((reminder) => {
                  const application = byId.get(reminder.applicationId);
                  return (
                    <li key={reminder.id} className="flex items-center gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleDone(reminder.id, true)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line-strong text-transparent transition hover:border-emerald-500 hover:text-emerald-500"
                        title="Marcar como hecho"
                        aria-label="Marcar como hecho"
                      >
                        <FaIcon icon={faCheck} size={12} />
                      </button>

                      <button
                        type="button"
                        onClick={() => application && onOpenApplication(application.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-title font-medium text-ink">
                          {application
                            ? `${application.jobTitle} · ${application.company}`
                            : "Postulación"}
                        </span>
                        <span className="block truncate text-label text-ink-muted">
                          {reminder.message ?? "Seguimiento pendiente"}
                        </span>
                      </button>

                      <div className="shrink-0 text-right">
                        <p className="flex items-center gap-1 text-label text-ink-soft">
                          <FaIcon icon={faCalendarCheck} size={12} /> {formatDateEs(reminder.dueAt)}
                        </p>
                        <p className="text-label text-ink-subtle">{relativeTimeEs(reminder.dueAt)}</p>
                      </div>

                      <IconButton
                        label="Eliminar recordatorio"
                        icon={faTrashCan}
                        onClick={() => setPendingDelete(reminder.id)}
                        className="text-ink-subtle hover:text-danger"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}

      {done.length > 0 && (
        <section className="rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-title font-semibold text-ink-muted">
            Completados{" "}
            <span className="text-label font-normal text-ink-subtle">({done.length})</span>
          </h2>
          <ul className="divide-y divide-line">
            {done.map((reminder) => {
              const application = byId.get(reminder.applicationId);
              return (
                <li key={reminder.id} className="flex items-center gap-3 py-2 text-ink-subtle">
                  <button
                    type="button"
                    onClick={() => void toggleDone(reminder.id, false)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-white"
                    title="Marcar como pendiente"
                    aria-label="Marcar como pendiente"
                  >
                    <FaIcon icon={faCheck} size={12} />
                  </button>
                  <p className="min-w-0 flex-1 truncate text-title line-through">
                    {application
                      ? `${application.jobTitle} · ${application.company}`
                      : "Postulación"}
                  </p>
                  <p className="shrink-0 text-label">{formatDateEs(reminder.dueAt)}</p>
                  <Button size="xs" variant="ghost" onClick={() => void toggleDone(reminder.id, false)}>
                    Reabrir
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="¿Eliminar este recordatorio?"
        description="Se borrará de este navegador y del servidor la próxima vez que sincronices."
        confirmLabel="Eliminar"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
