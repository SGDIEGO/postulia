import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { scrapeLinkedInPosts } from "../services/linkedinScraper.js";
import { sendMail, verifySmtpConnection } from "../services/emailService.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";

const searchInputSchema = z.object({
  keywords: z.string().min(1, "Las palabras clave son obligatorias"),
  location: z.string().optional().nullable(),
});

const postPatchSchema = z.object({
  prospectEmail: z.string().email().optional().nullable(),
  prospectName: z.string().optional().nullable(),
  emailSubject: z.string().optional().nullable(),
  emailBody: z.string().optional().nullable(),
  emailStatus: z
    .enum(["pending", "edited", "approved", "sent", "error"])
    .optional(),
});

const sendMailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export default async function linkedinRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  function userIdOf(request: { user: { sub: string } }): string {
    return request.user.sub;
  }

  /* --------------------------- Búsquedas --------------------------- */

  app.get("/api/linkedin/searches", async (request) => {
    const userId = userIdOf(request);
    const searches = await app.prisma.linkedInSearch.findMany({
      where: { userId, estado: 1 },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { posts: true } },
      },
    });
    return searches;
  });

  app.post("/api/linkedin/searches", async (request, reply) => {
    const parsed = searchInputSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);
    const userId = userIdOf(request);

    const created = await app.prisma.linkedInSearch.create({
      data: {
        userId,
        keywords: parsed.data.keywords,
        location: parsed.data.location ?? null,
        estado: 1,
      },
    });

    reply.code(201);
    return created;
  });

  app.patch("/api/linkedin/searches/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const existing = await app.prisma.linkedInSearch.findFirst({
      where: { id, userId, estado: 1 },
    });
    if (!existing) throw notFound("Búsqueda no encontrada");

    const parsed = searchInputSchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    return app.prisma.linkedInSearch.update({
      where: { id },
      data: {
        ...(parsed.data.keywords !== undefined && { keywords: parsed.data.keywords }),
        ...(parsed.data.location !== undefined && { location: parsed.data.location ?? null }),
      },
    });
  });

  app.delete("/api/linkedin/searches/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const existing = await app.prisma.linkedInSearch.findFirst({
      where: { id, userId },
    });
    if (!existing) throw notFound("Búsqueda no encontrada");

    await app.prisma.linkedInSearch.update({
      where: { id },
      data: { estado: 2, deletedAt: new Date(), deletedBy: userId },
    });

    reply.code(204);
    return null;
  });

  /* --------------------------- Scraping --------------------------- */

  app.post("/api/linkedin/searches/:id/scrape", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const search = await app.prisma.linkedInSearch.findFirst({
      where: { id, userId, estado: 1 },
    });
    if (!search) throw notFound("Búsqueda no encontrada");

    try {
      const posts = await scrapeLinkedInPosts(search.keywords, search.location ?? undefined, 20);

      const createdPosts = [];
      for (const post of posts) {
        try {
          const created = await app.prisma.linkedInPost.create({
            data: {
              searchId: id,
              userId,
              linkedinPostUrl: post.linkedinPostUrl,
              recruiterName: post.recruiterName ?? null,
              company: post.company ?? null,
              title: post.title ?? null,
              contentSnippet: post.contentSnippet ?? null,
              postedAt: post.postedAt ?? null,
              emailStatus: "pending",
              estado: 1,
            },
          });
          createdPosts.push(created);
        } catch {
          // URL duplicada, se ignora
        }
      }

      await app.prisma.linkedInSearch.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });

      reply.code(201);
      return {
        searched: posts.length,
        saved: createdPosts.length,
        posts: createdPosts,
      };
    } catch (error) {
      request.log.error({ err: error }, "Error en scraping de LinkedIn");
      throw badRequest("No se pudo completar el scraping. Intenta de nuevo más tarde.");
    }
  });

  /* --------------------------- Posts --------------------------- */

  app.get("/api/linkedin/posts", async (request) => {
    const userId = userIdOf(request);
    const query = request.query as {
      emailStatus?: string;
      estado?: string;
      searchId?: string;
      limit?: string;
      offset?: string;
    };

    const where: Record<string, unknown> = { userId };
    if (query.estado) where.estado = Number(query.estado);
    else where.estado = 1; // solo activos por defecto
    if (query.emailStatus) where.emailStatus = query.emailStatus;
    if (query.searchId) where.searchId = query.searchId;

    const limit = Math.min(parseInt(query.limit ?? "50", 10), 100);
    const offset = parseInt(query.offset ?? "0", 10);

    const [items, total] = await Promise.all([
      app.prisma.linkedInPost.findMany({
        where,
        orderBy: { scrapedAt: "desc" },
        take: limit,
        skip: offset,
        include: { search: { select: { id: true, keywords: true } } },
      }),
      app.prisma.linkedInPost.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  app.get("/api/linkedin/posts/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const post = await app.prisma.linkedInPost.findFirst({
      where: { id, userId },
      include: { search: true, emailLog: { orderBy: { sentAt: "desc" }, take: 10 } },
    });
    if (!post) throw notFound("Post no encontrado");

    return post;
  });

  app.patch("/api/linkedin/posts/:id", async (request) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const existing = await app.prisma.linkedInPost.findFirst({
      where: { id, userId, estado: 1 },
    });
    if (!existing) throw notFound("Post no encontrado");

    const parsed = postPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const data: Record<string, unknown> = {};
    if (parsed.data.prospectEmail !== undefined) data.prospectEmail = parsed.data.prospectEmail ?? null;
    if (parsed.data.prospectName !== undefined) data.prospectName = parsed.data.prospectName ?? null;
    if (parsed.data.emailSubject !== undefined) data.emailSubject = parsed.data.emailSubject ?? null;
    if (parsed.data.emailBody !== undefined) data.emailBody = parsed.data.emailBody ?? null;
    if (parsed.data.emailStatus !== undefined) data.emailStatus = parsed.data.emailStatus;

    return app.prisma.linkedInPost.update({ where: { id }, data });
  });

  app.delete("/api/linkedin/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const existing = await app.prisma.linkedInPost.findFirst({
      where: { id, userId },
    });
    if (!existing) throw notFound("Post no encontrado");

    await app.prisma.linkedInPost.update({
      where: { id },
      data: { estado: 2, deletedAt: new Date(), deletedBy: userId },
    });

    reply.code(204);
    return null;
  });

  /* --------------------------- Envío de correo --------------------------- */

  app.post("/api/linkedin/posts/:id/send", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = userIdOf(request);

    const post = await app.prisma.linkedInPost.findFirst({
      where: { id, userId, estado: 1 },
    });
    if (!post) throw notFound("Post no encontrado");

    if (!post.prospectEmail) {
      throw badRequest("Falta el correo del prospecto. Edita el post antes de enviar.");
    }

    const parsed = sendMailSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const subject = parsed.data.subject ?? post.emailSubject ?? `Oportunidad: ${post.title ?? "vacante"}`;
    const body = parsed.data.body ?? post.emailBody ?? "";

    try {
      const smtpOk = await verifySmtpConnection(app.env);
      if (!smtpOk) {
        throw badRequest("No se pudo conectar con el servidor SMTP. Revisa tus credenciales de Gmail.");
      }

      const result = await sendMail(app.env, {
        to: post.prospectEmail,
        subject,
        body,
      });

      // Registrar el envío
      await app.prisma.emailLog.create({
        data: {
          postId: id,
          userId,
          recipientEmail: post.prospectEmail,
          subject,
          body,
          status: result.rejected.length === 0 ? "sent" : "error",
          errorMessage: result.rejected.length > 0 ? `Rechazados: ${result.rejected.join(", ")}` : null,
          estado: 1,
        },
      });

      // Actualizar estado del post
      await app.prisma.linkedInPost.update({
        where: { id },
        data: {
          emailStatus: result.rejected.length === 0 ? "sent" : "error",
          sentAt: new Date(),
          sentBy: userId,
          smtpResponse: result.response,
        },
      });

      reply.code(200);
      return {
        accepted: result.accepted,
        rejected: result.rejected,
        response: result.response,
      };
    } catch (error) {
      // Registrar error
      await app.prisma.emailLog.create({
        data: {
          postId: id,
          userId,
          recipientEmail: post.prospectEmail,
          subject,
          body,
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Error desconocido",
          estado: 1,
        },
      });

      await app.prisma.linkedInPost.update({
        where: { id },
        data: {
          emailStatus: "error",
          smtpResponse: error instanceof Error ? error.message : "Error desconocido",
        },
      });

      throw error;
    }
  });

  /* --------------------------- Logs de correo --------------------------- */

  app.get("/api/linkedin/email-logs", async (request) => {
    const userId = userIdOf(request);
    const query = request.query as { postId?: string; limit?: string; offset?: string };

    const where: Record<string, unknown> = { userId, estado: 1 };
    if (query.postId) where.postId = query.postId;

    const limit = Math.min(parseInt(query.limit ?? "50", 10), 100);
    const offset = parseInt(query.offset ?? "0", 10);

    const [items, total] = await Promise.all([
      app.prisma.emailLog.findMany({
        where,
        orderBy: { sentAt: "desc" },
        take: limit,
        skip: offset,
        include: { post: { select: { id: true, title: true, linkedinPostUrl: true } } },
      }),
      app.prisma.emailLog.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  /* --------------------------- Verificar SMTP --------------------------- */

  app.get("/api/linkedin/smtp/verify", async (request) => {
    const ok = await verifySmtpConnection(app.env);
    return { ok };
  });
}
