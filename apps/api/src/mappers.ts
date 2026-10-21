import type { Application, ApplicationEvent, ApplicationTag, Reminder, Tag } from "@prisma/client";
import {
  APPLICATION_STATUSES,
  EVENT_TYPES,
  SOURCES,
  WORK_MODES,
  type ApplicationStatus,
  type ApplicationSync,
  type EventSync,
  type EventType,
  type ReminderSync,
  type Source,
  type TagSync,
  type UserProfile,
  type WorkMode,
} from "@postulia/shared";
import type { Db } from "./lib/db.js";
import { colorForTag } from "./lib/db.js";

export type ApplicationWithTags = Application & {
  tags: (ApplicationTag & { tag: Tag })[];
};

export const applicationInclude = { tags: { include: { tag: true } } } as const;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

const asSource = (value: string): Source =>
  (SOURCES as readonly string[]).includes(value) ? (value as Source) : "other";

const asStatus = (value: string): ApplicationStatus =>
  (APPLICATION_STATUSES as readonly string[]).includes(value)
    ? (value as ApplicationStatus)
    : "saved";

const asWorkMode = (value: string | null): WorkMode | null =>
  value && (WORK_MODES as readonly string[]).includes(value) ? (value as WorkMode) : null;

const asEventType = (value: string): EventType =>
  (EVENT_TYPES as readonly string[]).includes(value) ? (value as EventType) : "other";

export function toApplicationSync(row: ApplicationWithTags): ApplicationSync {
  return {
    id: row.id,
    jobTitle: row.jobTitle,
    company: row.company,
    url: row.url ?? null,
    urlHash: row.urlHash ?? null,
    source: asSource(row.source),
    location: row.location ?? null,
    workMode: asWorkMode(row.workMode),
    salary: row.salary ?? null,
    currency: row.currency ?? null,
    contractType: row.contractType ?? null,
    status: asStatus(row.status),
    appliedAt: iso(row.appliedAt),
    notes: row.notes ?? null,
    recruiterName: row.recruiterName ?? null,
    recruiterContact: row.recruiterContact ?? null,
    cvVersion: row.cvVersion ?? null,
    tags: row.tags.map((entry) => entry.tag.name).sort((a, b) => a.localeCompare(b)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toEventSync(row: ApplicationEvent): EventSync {
  return {
    id: row.id,
    applicationId: row.applicationId,
    type: asEventType(row.type),
    message: row.message ?? null,
    fromStatus: row.fromStatus ? asStatus(row.fromStatus) : null,
    toStatus: row.toStatus ? asStatus(row.toStatus) : null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toReminderSync(row: Reminder): ReminderSync {
  return {
    id: row.id,
    applicationId: row.applicationId,
    dueAt: row.dueAt.toISOString(),
    message: row.message ?? null,
    done: row.done,
    notifiedAt: iso(row.notifiedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toTagSync(row: Tag): TagSync {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  };
}

export function toUserProfile(row: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reconcilia las etiquetas de una postulación a partir de una lista de nombres.
 * Crea las etiquetas que no existan y ajusta los vínculos.
 */
export async function reconcileApplicationTags(
  db: Db,
  userId: string,
  applicationId: string,
  names: string[],
): Promise<void> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];

  const tagIds: string[] = [];
  for (const name of unique) {
    const existing = await db.tag.findUnique({ where: { userId_name: { userId, name } } });
    if (existing) {
      if (existing.deletedAt) {
        await db.tag.update({ where: { id: existing.id }, data: { deletedAt: null } });
      }
      tagIds.push(existing.id);
      continue;
    }
    const created = await db.tag.create({
      data: { userId, name, color: colorForTag(name) },
    });
    tagIds.push(created.id);
  }

  const current = await db.applicationTag.findMany({ where: { applicationId } });
  const currentIds = new Set(current.map((entry) => entry.tagId));
  const wantedIds = new Set(tagIds);

  const toAdd = tagIds.filter((tagId) => !currentIds.has(tagId));
  const toRemove = current.filter((entry) => !wantedIds.has(entry.tagId));

  if (toAdd.length > 0) {
    await db.applicationTag.createMany({
      data: toAdd.map((tagId) => ({ applicationId, tagId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await db.applicationTag.deleteMany({
      where: { applicationId, tagId: { in: toRemove.map((entry) => entry.tagId) } },
    });
  }
}
