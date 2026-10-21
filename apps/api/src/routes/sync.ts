import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  hashUrl,
  syncPushSchema,
  type SyncPullResult,
  type SyncPushResult,
} from "@postulia/shared";
import { badRequest } from "../lib/errors.js";
import { colorForTag } from "../lib/db.js";
import {
  applicationInclude,
  reconcileApplicationTags,
  toApplicationSync,
  toEventSync,
  toReminderSync,
  toTagSync,
} from "../mappers.js";

const PULL_LIMIT = 2000;

const iso = (value: Date | string | null | undefined): Date | null =>
  value ? new Date(value) : null;

export default async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  /**
   * Sube los cambios locales. Estrategia "last write wins": gana el registro
   * con `updatedAt` más reciente y el perdedor se devuelve en `conflicts`.
   */
  app.post("/api/sync/push", async (request) => {
    const parsed = syncPushSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Lote de sincronización inválido", parsed.error.issues);

    const payload = parsed.data;
    const userId = request.user.sub;

    const result: SyncPushResult = {
      serverTime: new Date().toISOString(),
      applied: { applications: [], events: [], reminders: [], tags: [] },
      conflicts: { applications: [], events: [], reminders: [], tags: [] },
    };

    /* ------------------------------- Etiquetas ------------------------------ */
    for (const incoming of payload.tags) {
      const existing = await app.prisma.tag.findFirst({
        where: { userId, name: incoming.name },
      });

      if (existing) {
        if (existing.updatedAt.getTime() > new Date(incoming.updatedAt).getTime()) {
          result.conflicts.tags.push(toTagSync(existing));
          continue;
        }
        const updated = await app.prisma.tag.update({
          where: { id: existing.id },
          data: {
            color: incoming.color ?? existing.color ?? colorForTag(incoming.name),
            deletedAt: iso(incoming.deletedAt),
          },
        });
        result.applied.tags.push(updated.id);
        continue;
      }

      // Evita chocar con un id ya existente de otro usuario.
      const idTaken = await app.prisma.tag.findUnique({ where: { id: incoming.id } });
      const created = await app.prisma.tag.create({
        data: {
          id: idTaken ? undefined : incoming.id,
          userId,
          name: incoming.name,
          color: incoming.color ?? colorForTag(incoming.name),
          deletedAt: iso(incoming.deletedAt),
        },
      });
      result.applied.tags.push(created.id);
    }

    /* ---------------------------- Postulaciones ----------------------------- */
    for (const incoming of payload.applications) {
      const updatedAt = new Date(incoming.updatedAt);
      const existing = await app.prisma.application.findUnique({
        where: { id: incoming.id },
        include: applicationInclude,
      });

      if (existing && existing.userId !== userId) continue;

      const shared = {
        jobTitle: incoming.jobTitle,
        company: incoming.company,
        url: incoming.url ?? null,
        urlHash: incoming.url ? await hashUrl(incoming.url) : (incoming.urlHash ?? null),
        source: incoming.source,
        location: incoming.location ?? null,
        workMode: incoming.workMode ?? null,
        salary: incoming.salary ?? null,
        currency: incoming.currency ?? null,
        contractType: incoming.contractType ?? null,
        status: incoming.status,
        appliedAt: iso(incoming.appliedAt),
        notes: incoming.notes ?? null,
        recruiterName: incoming.recruiterName ?? null,
        recruiterContact: incoming.recruiterContact ?? null,
        cvVersion: incoming.cvVersion ?? null,
        deletedAt: iso(incoming.deletedAt),
      };

      if (!existing) {
        const created = await app.prisma.application.create({
          data: {
            id: incoming.id,
            userId,
            ...shared,
            createdAt: new Date(incoming.createdAt),
            updatedAt,
          },
          include: applicationInclude,
        });
        if (incoming.tags.length > 0) {
          await reconcileApplicationTags(app.prisma, userId, created.id, incoming.tags);
        }
        result.applied.applications.push(created.id);
        continue;
      }

      if (existing.updatedAt.getTime() > updatedAt.getTime()) {
        result.conflicts.applications.push(toApplicationSync(existing));
        continue;
      }

      await app.prisma.application.update({ where: { id: incoming.id }, data: shared });
      await reconcileApplicationTags(app.prisma, userId, incoming.id, incoming.tags);
      result.applied.applications.push(incoming.id);
    }

    /* -------------------------------- Eventos ------------------------------- */
    for (const incoming of payload.events) {
      const application = await app.prisma.application.findFirst({
        where: { id: incoming.applicationId, userId },
        select: { id: true },
      });
      if (!application) continue;

      const existing = await app.prisma.applicationEvent.findUnique({
        where: { id: incoming.id },
      });

      if (existing && existing.userId !== userId) continue;

      const data: Prisma.ApplicationEventUncheckedCreateInput = {
        id: incoming.id,
        applicationId: incoming.applicationId,
        userId,
        type: incoming.type,
        message: incoming.message ?? null,
        fromStatus: incoming.fromStatus ?? null,
        toStatus: incoming.toStatus ?? null,
        occurredAt: new Date(incoming.occurredAt),
        deletedAt: iso(incoming.deletedAt),
      };

      if (!existing) {
        await app.prisma.applicationEvent.create({ data });
        result.applied.events.push(incoming.id);
        continue;
      }

      if (existing.updatedAt.getTime() > new Date(incoming.updatedAt).getTime()) {
        result.conflicts.events.push(toEventSync(existing));
        continue;
      }

      await app.prisma.applicationEvent.update({
        where: { id: incoming.id },
        data: {
          type: data.type,
          message: data.message,
          fromStatus: data.fromStatus,
          toStatus: data.toStatus,
          occurredAt: data.occurredAt,
          deletedAt: data.deletedAt,
        },
      });
      result.applied.events.push(incoming.id);
    }

    /* ----------------------------- Recordatorios ---------------------------- */
    for (const incoming of payload.reminders) {
      const application = await app.prisma.application.findFirst({
        where: { id: incoming.applicationId, userId },
        select: { id: true },
      });
      if (!application) continue;

      const existing = await app.prisma.reminder.findUnique({ where: { id: incoming.id } });
      if (existing && existing.userId !== userId) continue;

      const data = {
        dueAt: new Date(incoming.dueAt),
        message: incoming.message ?? null,
        done: incoming.done,
        notifiedAt: iso(incoming.notifiedAt),
        deletedAt: iso(incoming.deletedAt),
      };

      if (!existing) {
        await app.prisma.reminder.create({
          data: {
            id: incoming.id,
            applicationId: incoming.applicationId,
            userId,
            ...data,
            createdAt: new Date(incoming.createdAt),
            updatedAt: new Date(incoming.updatedAt),
          },
        });
        result.applied.reminders.push(incoming.id);
        continue;
      }

      if (existing.updatedAt.getTime() > new Date(incoming.updatedAt).getTime()) {
        result.conflicts.reminders.push(toReminderSync(existing));
        continue;
      }

      await app.prisma.reminder.update({ where: { id: incoming.id }, data });
      result.applied.reminders.push(incoming.id);
    }

    return result;
  });

  /** Devuelve todo lo modificado después de `since` (hora del servidor). */
  app.get("/api/sync/pull", async (request) => {
    const query = request.query as { since?: string };
    const userId = request.user.sub;
    const serverTime = new Date();

    const since = query.since ? new Date(query.since) : new Date(0);
    if (Number.isNaN(since.getTime()))
      throw badRequest("El parámetro since no es una fecha válida");

    const [applications, events, reminders, tags] = await Promise.all([
      app.prisma.application.findMany({
        where: { userId, updatedAt: { gt: since } },
        orderBy: { updatedAt: "asc" },
        take: PULL_LIMIT,
        include: applicationInclude,
      }),
      app.prisma.applicationEvent.findMany({
        where: { userId, updatedAt: { gt: since } },
        orderBy: { updatedAt: "asc" },
        take: PULL_LIMIT,
      }),
      app.prisma.reminder.findMany({
        where: { userId, updatedAt: { gt: since } },
        orderBy: { updatedAt: "asc" },
        take: PULL_LIMIT,
      }),
      app.prisma.tag.findMany({
        where: { userId, updatedAt: { gt: since } },
        orderBy: { updatedAt: "asc" },
        take: PULL_LIMIT,
      }),
    ]);

    const result: SyncPullResult = {
      serverTime: serverTime.toISOString(),
      applications: applications.map(toApplicationSync),
      events: events.map(toEventSync),
      reminders: reminders.map(toReminderSync),
      tags: tags.map(toTagSync),
    };

    return result;
  });
}
