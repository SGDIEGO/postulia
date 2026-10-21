import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { isoDateTime } from "@postulia/shared";
import { badRequest, notFound } from "../lib/errors.js";
import { toReminderSync } from "../mappers.js";

const reminderPatchSchema = z.object({
  dueAt: isoDateTime.optional(),
  message: z.string().max(500).nullish(),
  done: z.boolean().optional(),
  notifiedAt: isoDateTime.nullish(),
});

export default async function remindersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/api/reminders", async (request) => {
    const query = request.query as { pending?: string; limit?: string };
    const userId = request.user.sub;

    const take = Math.min(Number(query.limit ?? 200) || 200, 500);
    const where: Prisma.ReminderWhereInput = {
      userId,
      deletedAt: null,
      ...(query.pending === "1"
        ? { done: false, dueAt: { lte: new Date(Date.now() + 86_400_000) } }
        : {}),
    };

    const reminders = await app.prisma.reminder.findMany({
      where,
      orderBy: { dueAt: "asc" },
      take,
      include: { application: { select: { id: true, jobTitle: true, company: true } } },
    });

    return reminders.map((reminder) => ({
      ...toReminderSync(reminder),
      application: reminder.application,
    }));
  });

  app.patch("/api/reminders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;

    const current = await app.prisma.reminder.findFirst({ where: { id, userId } });
    if (!current) throw notFound("Recordatorio no encontrado");

    const parsed = reminderPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);
    const patch = parsed.data;
    const raw = (request.body ?? {}) as Record<string, unknown>;

    const data: Prisma.ReminderUpdateInput = {};
    if ("dueAt" in raw && patch.dueAt) data.dueAt = new Date(patch.dueAt);
    if ("message" in raw) data.message = patch.message?.trim() || null;
    if ("done" in raw && patch.done !== undefined) data.done = patch.done;
    if ("notifiedAt" in raw) data.notifiedAt = patch.notifiedAt ? new Date(patch.notifiedAt) : null;

    const updated = await app.prisma.reminder.update({ where: { id }, data });
    return toReminderSync(updated);
  });

  app.delete("/api/reminders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;

    const current = await app.prisma.reminder.findFirst({ where: { id, userId } });
    if (!current) throw notFound("Recordatorio no encontrado");

    await app.prisma.reminder.update({ where: { id }, data: { deletedAt: new Date() } });
    reply.code(204);
    return null;
  });
}
