import { useEffect, useState } from "react";
import {
  faArrowRight,
  faArrowUpRightFromSquare,
  faTrashCan,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  APPLICATION_STATUSES,
  CONTRACT_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  addDays,
  formatDateEs,
  formatDateTimeEs,
  relativeTimeEs,
  type ApplicationStatus,
  type ContractType,
  type EventType,
  type WorkMode,
} from "@postulia/shared";
import {
  addEvent,
  addReminder,
  changeStatus,
  deleteReminder,
  softDeleteApplication,
  updateApplication,
  updateReminder,
} from "~/lib/repository";
import { useApplication, useEvents, useReminders } from "~/lib/hooks";
import { FaIcon } from "~/components/FaIcon";
import { ApplicationForm } from "./ApplicationForm";
import { StatusBadge } from "./StatusBadge";
import { Button, Field, Input, Spinner, Textarea, cn } from "./ui";

const EVENT_COLORS: Record<EventType, string> = {
  created: "#94a3b8",
  status_change: "#3b82f6",
  note: "#64748b",
  interview: "#f59e0b",
  email: "#06b6d4",
  offer: "#10b981",
  rejection: "#ef4444",
  reminder: "#8b5cf6",
  follow_up: "#6366f1",
  other: "#94a3b8",
};

export function ApplicationDetail({
  applicationId,
  onClose,
}: {
  applicationId: string | null;
  onClose: () => void;
}) {
  const application = useApplication(applicationId);
  const events = useEvents(applicationId);
  const reminders = useReminders({ applicationId });
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState("");
  const [reminderDue, setReminderDue] = useState(() =>
    addDays(new Date(), 7).toISOString().slice(0, 10),
  );
  const [reminderMessage, setReminderMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    setNotes(application?.notes ?? "");
    setNote("");
    setEditing(false);
  }, [applicationId, application?.notes]);

  if (!applicationId) return null;

  if (!application) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-6">
          <Spinner label="Cargando postulación…" />
        </div>
      </Overlay>
    );
  }

  async function handleDelete() {
    if (
      !window.confirm("¿Eliminar esta postulación? Podrás recuperarla desde Ajustes > Papelera.")
    ) {
      return;
    }
    await softDeleteApplication(applicationId!);
    onClose();
  }

  async function saveNotes() {
    if (!application) return;
    setSavingNotes(true);
    try {
      await updateApplication(application.id, { notes: notes.trim() || null });
    } finally {
      setSavingNotes(false);
    }
  }

  async function submitNote() {
    if (!application || !note.trim()) return;
    await addEvent(application.id, { type: "note", message: note.trim() });
    setNote("");
  }

  async function submitReminder() {
    if (!application || !reminderDue) return;
    await addReminder(application.id, {
      dueAt: new Date(`${reminderDue}T09:00:00`).toISOString(),
      message: reminderMessage.trim() || null,
    });
    setReminderMessage("");
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">
              {application.jobTitle}
            </h2>
            <p className="truncate text-sm text-slate-500">
              {application.company}
              {application.location ? ` · ${application.location}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={application.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {SOURCE_LABELS[application.source]}
              </span>
              {application.url && (
                <a
                  href={application.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  Ver oferta original <FaIcon icon={faArrowUpRightFromSquare} size={10} />
                </a>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} title="Cerrar" aria-label="Cerrar">
              <FaIcon icon={faXmark} size={14} />
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <Field label="Estado">
              <select
                value={application.status}
                onChange={(event) =>
                  void changeStatus(application.id, event.target.value as ApplicationStatus)
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {APPLICATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Meta label="Postulada" value={formatDateEs(application.appliedAt)} />
              <Meta label="Actualizada" value={formatDateEs(application.updatedAt)} />
              <Meta
                label="Modalidad"
                value={
                  application.workMode ? WORK_MODE_LABELS[application.workMode as WorkMode] : "—"
                }
              />
              <Meta
                label="Contrato"
                value={
                  application.contractType
                    ? (CONTRACT_TYPE_LABELS[application.contractType as ContractType] ??
                      application.contractType)
                    : "—"
                }
              />
              <Meta
                label="Salario"
                value={
                  application.salary
                    ? `${application.salary} ${application.currency ?? ""}`.trim()
                    : "—"
                }
              />
              <Meta label="CV" value={application.cvVersion ?? "—"} />
              <Meta label="Reclutador" value={application.recruiterName ?? "—"} />
              <Meta label="Contacto" value={application.recruiterContact ?? "—"} />
            </div>
          </section>

          {application.tags.length > 0 && (
            <section className="flex flex-wrap gap-1">
              {application.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                >
                  #{tag}
                </span>
              ))}
            </section>
          )}

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notas
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void saveNotes()}
                disabled={savingNotes}
              >
                {savingNotes ? "Guardando…" : "Guardar notas"}
              </Button>
            </div>
            <Textarea
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Requisitos, impresiones, preguntas para la entrevista…"
            />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recordatorios
            </h3>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <Field label="Fecha" className="w-36">
                <Input
                  type="date"
                  value={reminderDue}
                  onChange={(event) => setReminderDue(event.target.value)}
                />
              </Field>
              <Field label="Mensaje" className="min-w-40 flex-1">
                <Input
                  value={reminderMessage}
                  onChange={(event) => setReminderMessage(event.target.value)}
                  placeholder="Escribir al reclutador"
                />
              </Field>
              <Button size="sm" onClick={() => void submitReminder()}>
                Añadir
              </Button>
            </div>

            {reminders.length === 0 ? (
              <p className="text-xs text-slate-400">Sin recordatorios para esta postulación.</p>
            ) : (
              <ul className="space-y-1">
                {reminders.map((reminder) => {
                  const overdue = !reminder.done && new Date(reminder.dueAt).getTime() < Date.now();
                  return (
                    <li
                      key={reminder.id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                        reminder.done
                          ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                          : overdue
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void updateReminder(reminder.id, { done: !reminder.done })}
                        className="flex items-center gap-2 text-left"
                      >
                        <span
                          className={cn(
                            "h-3.5 w-3.5 rounded border",
                            reminder.done
                              ? "border-emerald-500 bg-emerald-500"
                              : "border-slate-300 bg-white",
                          )}
                        />
                        <span>
                          {formatDateEs(reminder.dueAt)}
                          {reminder.message ? ` · ${reminder.message}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteReminder(reminder.id)}
                        className="text-slate-300 hover:text-rose-500"
                        aria-label="Eliminar recordatorio"
                        title="Eliminar recordatorio"
                      >
                        <FaIcon icon={faTrashCan} size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Historial
            </h3>
            <div className="mb-2 flex gap-2">
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Añadir una nota al historial…"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitNote();
                }}
              />
              <Button size="sm" variant="secondary" onClick={() => void submitNote()}>
                Añadir
              </Button>
            </div>

            <ol className="space-y-2 border-l border-slate-200 pl-4">
              {events.map((event) => (
                <li key={event.id} className="relative text-xs">
                  <span
                    className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: EVENT_COLORS[event.type] }}
                  />
                  <p className="font-medium text-slate-700">
                    {EVENT_TYPE_LABELS[event.type]}
                    {event.fromStatus && event.toStatus && (
                      <span className="inline-flex items-center gap-1 font-normal text-slate-500">
                        <span>·</span>
                        <span>{STATUS_LABELS[event.fromStatus]}</span>
                        <FaIcon icon={faArrowRight} size={9} />
                        <span>{STATUS_LABELS[event.toStatus]}</span>
                      </span>
                    )}
                  </p>
                  {event.message && <p className="text-slate-600">{event.message}</p>}
                  <p className="text-slate-400" title={formatDateTimeEs(event.occurredAt)}>
                    {relativeTimeEs(event.occurredAt)} · {formatDateTimeEs(event.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => void handleDelete()}>
            Eliminar postulación
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </footer>
      </div>

      <ApplicationForm open={editing} initial={application} onClose={() => setEditing(false)} />
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 h-full w-full max-w-2xl overflow-hidden bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-slate-700">{value}</p>
    </div>
  );
}
