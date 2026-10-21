import { formatDateEs, nowIso } from "@postulia/shared";
import { browser } from "wxt/browser";
import { db } from "./db";
import { getSettings } from "./settings";

/** Notifica los recordatorios vencidos y los marca como avisados. */
export async function checkDueReminders(): Promise<number> {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return 0;

  const now = Date.now();
  const due = await db.reminders
    .filter(
      (reminder) =>
        !reminder.done &&
        !reminder.deletedAt &&
        !reminder.notifiedAt &&
        new Date(reminder.dueAt).getTime() <= now,
    )
    .toArray();

  if (due.length === 0) return 0;

  for (const reminder of due) {
    const application = await db.applications.get(reminder.applicationId);
    const title = application
      ? `Seguimiento: ${application.company}`
      : "Recordatorio de seguimiento";
    const message =
      reminder.message ??
      (application
        ? `Revisa tu postulación a ${application.jobTitle} (postulaste el ${formatDateEs(application.appliedAt)})`
        : "Tienes un seguimiento pendiente");

    await browser.notifications.create(`postulia-reminder-${reminder.id}`, {
      type: "basic",
      title,
      message,
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      priority: 1,
    });

    await db.reminders.update(reminder.id, { notifiedAt: nowIso(), dirty: 1 });
  }

  return due.length;
}

/** Resumen del día para el panel: recordatorios vencidos y próximos. */
export async function remindersSummary(): Promise<{ overdue: number; upcoming: number }> {
  const reminders = await db.reminders.filter((item) => !item.done && !item.deletedAt).toArray();
  const now = Date.now();
  const inThreeDays = now + 3 * 86_400_000;

  return {
    overdue: reminders.filter((item) => new Date(item.dueAt).getTime() < now).length,
    upcoming: reminders.filter((item) => {
      const due = new Date(item.dueAt).getTime();
      return due >= now && due <= inThreeDays;
    }).length,
  };
}
