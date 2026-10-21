import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  APPLICATION_STATUSES,
  EVENT_TYPES,
  SOURCES,
  applicationFiltersSchema,
  applicationInputSchema,
  hashUrl,
  isoDateTime,
  type ApplicationInput,
  type ApplicationStatus,
  type Source,
} from "@postulia/shared";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  applicationInclude,
  reconcileApplicationTags,
  toApplicationSync,
  toEventSync,
  toReminderSync,
} from "../mappers.js";

const eventInputSchema = z.object({
  id: z.uuid().optional(),
  type: z.enum(EVENT_TYPES).default("note"),
  message: z.string().max(5000).nullish(),
  fromStatus: z.enum(APPLICATION_STATUSES).nullish(),
  toStatus: z.enum(APPLICATION_STATUSES).nullish(),
  occurredAt: isoDateTime.optional(),
});

const reminderInputSchema = z.object({
  id: z.uuid().optional(),
  dueAt: isoDateTime,
  message: z.string().max(500).nullish(),
});

const PATCHABLE_FIELDS = [
  "jobTitle",
  "company",
  "url",
  "source",
  "location",
  "workMode",
  "salary",
  "currency",
  "contractType",
  "status",
  "appliedAt",
  "notes",
  "recruiterName",
  "recruiterContact",
  "cvVersion",
  "tags",
] as const satisfies readonly (keyof ApplicationInput)[];

const SORT_FIELDS = {
  updatedAt: "updatedAt",
  createdAt: "createdAt",
  appliedAt: "appliedAt",
  company: "company",
  jobTitle: "jobTitle",
} as const satisfies Record<string, keyof Prisma.ApplicationOrderByWithRelationInput>;

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export default async function applicationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  function userIdOf(request: { user: { sub: string } }): string {
    return request.user.sub;
  }

  async function findOwned(userId: string, id: string) {
    const record = await app.prisma.application.findFirst({
      where: { id, userId },
      include: applicationInclude,
    });
    if (!record) throw notFound("Postulación no encontrada");
    return record;
  }

  /** Indica si ya existe una postulación con la misma oferta. */
  app.get("/api/applications/lookup", async (request) => {
    const query = request.query as { url?: string };
    if (!query.url) throw badRequest("Falta el parámetro url");

    const urlHash = await hashUrl(query.url);
    const existing = await app.prisma.application.findFirst({
      where: { userId: userIdOf(request), urlHash, deletedAt: null },
      include: applicationInclude,
    });

    return existing
      ? { duplicate: true, application: toApplicationSync(existing) }
      : { duplicate: false, application: null };
  });

  app.get("/api/applications", async (request) => {
    const parsed = applicationFiltersSchema.safeParse(request.query ?? {});
    if (!parsed.success) throw badRequest("Filtros inválidos", parsed.error.issues);
    const filters = parsed.data;
    const userId = userIdOf(request);

    const statuses = filters.status
      ? Array.isArray(filters.status)
        ? filters.status
        : [filters.status]
      : undefined;
    const sources = filters.source
      ? Array.isArray(filters.source)
        ? filters.source
        : [filters.source]
      : undefined;

    const where: Prisma.ApplicationWhereInput = {
      userId,
      ...(filters.includeDeleted ? {} : { deletedAt: null }),
      ...(statuses ? { status: { in: statuses as ApplicationStatus[] } } : {}),
      ...(sources ? { source: { in: sources as Source[] } } : {}),
      ...(filters.tag ? { tags: { some: { tag: { name: filters.tag, userId } } } } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { jobTitle: { contains: filters.q, mode: "insensitive" } },
              { company: { contains: filters.q, mode: "insensitive" } },
              { notes: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = SORT_FIELDS[filters.sort ?? "updatedAt"];
    const orderBy = {
      [sortField]: filters.order ?? "desc",
    } as Prisma.ApplicationOrderByWithRelationInput;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const [items, total] = await Promise.all([
      app.prisma.application.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include: applicationInclude,
      }),
      app.prisma.application.count({ where }),
    ]);

    return { items: items.map(toApplicationSync), total, limit, offset };
  });

  app.get("/api/applications/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    const application = await findOwned(userId, id);

    const [events, reminders] = await Promise.all([
      app.prisma.applicationEvent.findMany({
        where: { applicationId: id, userId, deletedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 200,
      }),
      app.prisma.reminder.findMany({
        where: { applicationId: id, userId, deletedAt: null },
        orderBy: { dueAt: "asc" },
      }),
    ]);

    return {
      application: toApplicationSync(application),
      events: events.map(toEventSync),
      reminders: reminders.map(toReminderSync),
    };
  });

  app.post("/api/applications", async (request, reply) => {
    const parsed = applicationInputSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);
    const input = parsed.data;
    const userId = userIdOf(request);
    const force = (request.query as { force?: string }).force === "1";

    const urlHash = input.url ? await hashUrl(input.url) : null;

    if (urlHash && !force) {
      const duplicate = await app.prisma.application.findFirst({
        where: { userId, urlHash, deletedAt: null },
        include: applicationInclude,
      });
      if (duplicate) {
        throw conflict("Ya registraste esta oferta", {
          application: toApplicationSync(duplicate),
        });
      }
    }

    const status = input.status;
    const appliedAt = toDate(input.appliedAt) ?? (status !== "saved" ? new Date() : null);

    const created = await app.prisma.application.create({
      data: {
        userId,
        jobTitle: input.jobTitle,
        company: input.company,
        url: emptyToNull(input.url),
        urlHash,
        source: input.source,
        location: emptyToNull(input.location),
        workMode: input.workMode ?? null,
        salary: emptyToNull(input.salary),
        currency: emptyToNull(input.currency),
        contractType: emptyToNull(input.contractType),
        status,
        appliedAt,
        notes: emptyToNull(input.notes),
        recruiterName: emptyToNull(input.recruiterName),
        recruiterContact: emptyToNull(input.recruiterContact),
        cvVersion: emptyToNull(input.cvVersion),
      },
      include: applicationInclude,
    });

    if (input.tags.length > 0) {
      await reconcileApplicationTags(app.prisma, userId, created.id, input.tags);
    }

    await app.prisma.applicationEvent.create({
      data: {
        applicationId: created.id,
        userId,
        type: "created",
        message: `Postulación registrada (${input.jobTitle} en ${input.company})`,
        occurredAt: new Date(),
      },
    });

    reply.code(201);
    const fresh = await findOwned(userId, created.id);
    return toApplicationSync(fresh);
  });

  app.patch("/api/applications/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    const current = await findOwned(userId, id);

    const raw = (request.body ?? {}) as Record<string, unknown>;
    const parsed = applicationInputSchema.partial().safeParse(raw);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);
    const patch = parsed.data;

    // Solo se aplican las claves enviadas explícitamente.
    const present = new Set(
      Object.keys(raw).filter((key) => PATCHABLE_FIELDS.includes(key as never)),
    );

    const data: Prisma.ApplicationUpdateInput = {};
    if (present.has("jobTitle") && patch.jobTitle !== undefined) data.jobTitle = patch.jobTitle;
    if (present.has("company") && patch.company !== undefined) data.company = patch.company;
    if (present.has("source") && patch.source !== undefined) data.source = patch.source;
    if (present.has("location")) data.location = emptyToNull(patch.location);
    if (present.has("workMode")) data.workMode = patch.workMode ?? null;
    if (present.has("salary")) data.salary = emptyToNull(patch.salary);
    if (present.has("currency")) data.currency = emptyToNull(patch.currency);
    if (present.has("contractType")) data.contractType = emptyToNull(patch.contractType);
    if (present.has("appliedAt")) data.appliedAt = toDate(patch.appliedAt);
    if (present.has("notes")) data.notes = emptyToNull(patch.notes);
    if (present.has("recruiterName")) data.recruiterName = emptyToNull(patch.recruiterName);
    if (present.has("recruiterContact"))
      data.recruiterContact = emptyToNull(patch.recruiterContact);
    if (present.has("cvVersion")) data.cvVersion = emptyToNull(patch.cvVersion);
    if (present.has("url")) {
      data.url = emptyToNull(patch.url);
      data.urlHash = patch.url ? await hashUrl(patch.url) : null;
    }

    const nextStatus = present.has("status") && patch.status ? patch.status : null;
    if (nextStatus) {
      data.status = nextStatus;
      if (!current.appliedAt && !present.has("appliedAt") && nextStatus !== "saved") {
        data.appliedAt = new Date();
      }
    }

    if (Object.keys(data).length > 0) {
      await app.prisma.application.update({ where: { id }, data });
    }

    if (present.has("tags") && patch.tags) {
      await reconcileApplicationTags(app.prisma, userId, id, patch.tags);
    }

    if (nextStatus && nextStatus !== current.status) {
      await app.prisma.applicationEvent.create({
        data: {
          applicationId: id,
          userId,
          type: "status_change",
          fromStatus: current.status,
          toStatus: nextStatus,
          message: null,
          occurredAt: new Date(),
        },
      });
    }

    return toApplicationSync(await findOwned(userId, id));
  });

  app.delete("/api/applications/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    await findOwned(userId, id);

    await app.prisma.application.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    reply.code(204);
    return null;
  });

  /* ----------------------------- Timeline ------------------------------ */

  app.get("/api/applications/:id/timeline", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    await findOwned(userId, id);

    const events = await app.prisma.applicationEvent.findMany({
      where: { applicationId: id, userId, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      take: 500,
    });

    return events.map(toEventSync);
  });

  app.post("/api/applications/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    await findOwned(userId, id);

    const parsed = eventInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);
    const input = parsed.data;

    const created = await app.prisma.applicationEvent.create({
      data: {
        id: input.id,
        applicationId: id,
        userId,
        type: input.type,
        message: emptyToNull(input.message),
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        occurredAt: toDate(input.occurredAt) ?? new Date(),
      },
    });

    reply.code(201);
    return toEventSync(created);
  });

  app.delete("/api/applications/:id/events/:eventId", async (request, reply) => {
    const { id, eventId } = request.params as { id: string; eventId: string };
    const userId = userIdOf(request);
    await findOwned(userId, id);

    const event = await app.prisma.applicationEvent.findFirst({
      where: { id: eventId, applicationId: id, userId },
    });
    if (!event) throw notFound("Evento no encontrado");

    await app.prisma.applicationEvent.update({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });

    reply.code(204);
    return null;
  });

  /* ---------------------------- Recordatorios -------------------------- */

  app.post("/api/applications/:id/reminders", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);
    await findOwned(userId, id);

    const parsed = reminderInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const created = await app.prisma.reminder.create({
      data: {
        id: parsed.data.id,
        applicationId: id,
        userId,
        dueAt: new Date(parsed.data.dueAt),
        message: emptyToNull(parsed.data.message),
      },
    });

    reply.code(201);
    return toReminderSync(created);
  });
}
