import {
  addDays,
  hashUrl,
  newId,
  nowIso,
  textSimilarity,
  type ApplicationInput,
  type ApplicationStatus,
  type EventType,
} from "@postulia/shared";
import {
  db,
  type LocalApplication,
  type LocalEvent,
  type LocalReminder,
  type LocalTag,
} from "./db";
import { getSettings } from "./settings";

const DIRTY = 1 as const;

function buildEvent(
  applicationId: string,
  type: EventType,
  message: string | null,
  extra: { fromStatus?: ApplicationStatus | null; toStatus?: ApplicationStatus | null } = {},
): LocalEvent {
  const now = nowIso();
  return {
    id: newId(),
    applicationId,
    type,
    message,
    fromStatus: extra.fromStatus ?? null,
    toStatus: extra.toStatus ?? null,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: DIRTY,
  };
}

export async function ensureTags(names: string[]): Promise<void> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  const existing = await db.tags.where("name").anyOf(unique).toArray();
  const existingNames = new Set(existing.map((tag) => tag.name));
  const now = nowIso();

  for (const name of unique) {
    if (existingNames.has(name)) continue;
    const tag: LocalTag = {
      id: newId(),
      name,
      color: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dirty: DIRTY,
    };
    await db.tags.put(tag);
  }
}

export async function createApplication(
  input: ApplicationInput,
  options: { id?: string; appliedAt?: string | null } = {},
): Promise<LocalApplication> {
  const now = nowIso();
  const record: LocalApplication = {
    id: options.id ?? newId(),
    jobTitle: input.jobTitle,
    company: input.company,
    url: input.url ?? null,
    urlHash: input.url ? await hashUrl(input.url) : null,
    source: input.source,
    location: input.location ?? null,
    workMode: input.workMode ?? null,
    salary: input.salary ?? null,
    currency: input.currency ?? null,
    contractType: input.contractType ?? null,
    status: input.status,
    appliedAt: options.appliedAt ?? input.appliedAt ?? (input.status === "saved" ? null : now),
    notes: input.notes ?? null,
    recruiterName: input.recruiterName ?? null,
    recruiterContact: input.recruiterContact ?? null,
    cvVersion: input.cvVersion ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: DIRTY,
  };

  await db.transaction("rw", db.applications, db.events, db.tags, async () => {
    await db.applications.put(record);
    await ensureTags(record.tags);
    await db.events.put(
      buildEvent(
        record.id,
        "created",
        `Postulación registrada: ${record.jobTitle} en ${record.company}`,
      ),
    );
  });

  if (record.status !== "saved") {
    await scheduleFollowUp(record.id);
  }

  return record;
}

export async function updateApplication(
  id: string,
  patch: Partial<ApplicationInput>,
): Promise<LocalApplication | null> {
  const current = await db.applications.get(id);
  if (!current) return null;

  const next: LocalApplication = { ...current, ...patch, updatedAt: nowIso(), dirty: DIRTY };
  if (patch.url !== undefined) {
    next.urlHash = patch.url ? await hashUrl(patch.url) : null;
  }

  await db.transaction("rw", db.applications, db.tags, async () => {
    await db.applications.put(next);
    if (patch.tags) await ensureTags(patch.tags);
  });

  return next;
}

export async function changeStatus(
  id: string,
  status: ApplicationStatus,
): Promise<LocalApplication | null> {
  const current = await db.applications.get(id);
  if (!current || current.status === status) return current ?? null;

  const now = nowIso();
  const next: LocalApplication = {
    ...current,
    status,
    appliedAt: current.appliedAt ?? (status === "saved" ? null : now),
    updatedAt: now,
    dirty: DIRTY,
  };

  await db.transaction("rw", db.applications, db.events, async () => {
    await db.applications.put(next);
    await db.events.put(
      buildEvent(id, "status_change", null, { fromStatus: current.status, toStatus: status }),
    );
  });

  if (status === "applied") {
    await scheduleFollowUp(id);
  }

  return next;
}

/**
 * Crea automáticamente un recordatorio de seguimiento (si no existe uno
 * pendiente) para no dejar postulaciones en el olvido.
 */
export async function scheduleFollowUp(applicationId: string): Promise<LocalReminder | null> {
  const settings = await getSettings();
  const pending = await db.reminders
    .where("applicationId")
    .equals(applicationId)
    .filter((reminder) => !reminder.done && !reminder.deletedAt)
    .count();
  if (pending > 0) return null;

  const application = await db.applications.get(applicationId);
  if (!application) return null;

  const now = nowIso();
  const dueAt = addDays(application.appliedAt ?? now, settings.followUpDays).toISOString();
  const reminder: LocalReminder = {
    id: newId(),
    applicationId,
    dueAt,
    message: `Haz seguimiento a tu postulación en ${application.company}`,
    done: false,
    notifiedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: DIRTY,
  };

  await db.reminders.put(reminder);
  return reminder;
}

export async function softDeleteApplication(id: string): Promise<void> {
  const current = await db.applications.get(id);
  if (!current) return;
  await db.applications.put({ ...current, deletedAt: nowIso(), updatedAt: nowIso(), dirty: DIRTY });
}

export async function restoreApplication(id: string): Promise<void> {
  const current = await db.applications.get(id);
  if (!current) return;
  await db.applications.put({ ...current, deletedAt: null, updatedAt: nowIso(), dirty: DIRTY });
}

/** Elimina definitivamente en local (no propaga el borrado al servidor). */
export async function purgeApplication(id: string): Promise<void> {
  await db.transaction("rw", db.applications, db.events, db.reminders, async () => {
    await db.applications.delete(id);
    await db.events.where("applicationId").equals(id).delete();
    await db.reminders.where("applicationId").equals(id).delete();
  });
}

export async function addEvent(
  applicationId: string,
  input: {
    type: EventType;
    message?: string | null;
    occurredAt?: string;
    toStatus?: ApplicationStatus | null;
  },
): Promise<LocalEvent> {
  const event = buildEvent(applicationId, input.type, input.message ?? null, {
    toStatus: input.toStatus ?? null,
  });
  if (input.occurredAt) event.occurredAt = input.occurredAt;

  await db.transaction("rw", db.events, db.applications, async () => {
    await db.events.put(event);
    const application = await db.applications.get(applicationId);
    if (application) {
      await db.applications.put({ ...application, updatedAt: nowIso(), dirty: DIRTY });
    }
  });

  return event;
}

export async function addReminder(
  applicationId: string,
  input: { dueAt: string; message?: string | null },
): Promise<LocalReminder> {
  const now = nowIso();
  const reminder: LocalReminder = {
    id: newId(),
    applicationId,
    dueAt: input.dueAt,
    message: input.message ?? null,
    done: false,
    notifiedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: DIRTY,
  };
  await db.reminders.put(reminder);
  return reminder;
}

export async function updateReminder(
  id: string,
  patch: Partial<Pick<LocalReminder, "dueAt" | "message" | "done" | "notifiedAt">>,
): Promise<void> {
  const current = await db.reminders.get(id);
  if (!current) return;
  await db.reminders.put({ ...current, ...patch, updatedAt: nowIso(), dirty: DIRTY });
}

export async function deleteReminder(id: string): Promise<void> {
  const current = await db.reminders.get(id);
  if (!current) return;
  await db.reminders.put({ ...current, deletedAt: nowIso(), updatedAt: nowIso(), dirty: DIRTY });
}

export async function findDuplicateByUrl(url: string): Promise<LocalApplication | null> {
  const urlHash = await hashUrl(url);
  const matches = await db.applications.where("urlHash").equals(urlHash).toArray();
  return matches.find((application) => !application.deletedAt) ?? null;
}

/** Busca postulaciones parecidas por empresa/puesto (para avisar de duplicados). */
export async function findSimilar(company: string, jobTitle: string): Promise<LocalApplication[]> {
  const normalizedCompany = company.trim().toLowerCase();
  const candidates = await db.applications
    .filter((application) => !application.deletedAt)
    .toArray();

  return candidates
    .map((application) => {
      const sameCompany = application.company.trim().toLowerCase() === normalizedCompany;
      const titleScore = textSimilarity(application.jobTitle, jobTitle);
      return { application, score: (sameCompany ? 0.5 : 0) + titleScore };
    })
    .filter((entry) => entry.score >= 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.application);
}

export async function listActiveApplications(): Promise<LocalApplication[]> {
  const applications = await db.applications
    .filter((application) => !application.deletedAt)
    .toArray();
  return applications.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listUpcomingReminders(limit = 8): Promise<LocalReminder[]> {
  const reminders = await db.reminders
    .filter((reminder) => !reminder.done && !reminder.deletedAt)
    .toArray();
  return reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, limit);
}

export async function pendingChangesCount(): Promise<number> {
  const [applications, events, reminders, tags] = await Promise.all([
    db.applications.where("dirty").equals(DIRTY).count(),
    db.events.where("dirty").equals(DIRTY).count(),
    db.reminders.where("dirty").equals(DIRTY).count(),
    db.tags.where("dirty").equals(DIRTY).count(),
  ]);
  return applications + events + reminders + tags;
}
