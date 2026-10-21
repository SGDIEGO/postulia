import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TAG_COLORS, tagNameSchema } from "@postulia/shared";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { colorForTag } from "../lib/db.js";
import { toTagSync } from "../mappers.js";

const tagInputSchema = z.object({
  name: tagNameSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser hexadecimal, por ejemplo #3b82f6")
    .optional(),
});

const tagPatchSchema = z.object({
  name: tagNameSchema.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});

export default async function tagsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/api/tags", async (request) => {
    const userId = request.user.sub;
    const tags = await app.prisma.tag.findMany({
      where: { userId, deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { applications: true } } },
    });

    return tags.map((tag) => ({
      ...toTagSync(tag),
      applicationCount: tag._count.applications,
    }));
  });

  app.post("/api/tags", async (request, reply) => {
    const parsed = tagInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const userId = request.user.sub;
    const name = parsed.data.name.trim();

    const existing = await app.prisma.tag.findUnique({ where: { userId_name: { userId, name } } });
    if (existing && !existing.deletedAt) throw conflict("Ya existe una etiqueta con ese nombre");

    const tag = existing
      ? await app.prisma.tag.update({
          where: { id: existing.id },
          data: { deletedAt: null, color: parsed.data.color ?? existing.color },
        })
      : await app.prisma.tag.create({
          data: { userId, name, color: parsed.data.color ?? colorForTag(name) },
        });

    reply.code(201);
    return toTagSync(tag);
  });

  app.patch("/api/tags/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;

    const current = await app.prisma.tag.findFirst({ where: { id, userId } });
    if (!current) throw notFound("Etiqueta no encontrada");

    const parsed = tagPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const updated = await app.prisma.tag.update({
      where: { id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      },
    });

    return toTagSync(updated);
  });

  app.delete("/api/tags/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.sub;

    const current = await app.prisma.tag.findFirst({ where: { id, userId } });
    if (!current) throw notFound("Etiqueta no encontrada");

    await app.prisma.tag.update({ where: { id }, data: { deletedAt: new Date() } });
    reply.code(204);
    return null;
  });

  app.get("/api/tags/palette", async () => TAG_COLORS);
}
