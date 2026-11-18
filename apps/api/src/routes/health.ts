import type { FastifyInstance } from "fastify";
import { checkDatabase } from "../plugins/prisma.js";
import { isMailConfigured } from "../lib/mailer.js";

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const database = await checkDatabase(app);
    if (database !== "up") reply.code(503);
    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      // El correo es informativo: la API funciona sin SMTP, pero el registro
      // y el envío de CV con adjunto no.
      mail: isMailConfigured(app.env) ? "configured" : "unconfigured",
      version: process.env["npm_package_version"] ?? "0.1.0",
      time: new Date().toISOString(),
    };
  });
}
