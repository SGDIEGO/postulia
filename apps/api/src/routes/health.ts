import type { FastifyInstance } from "fastify";
import { checkDatabase } from "../plugins/prisma.js";

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const database = await checkDatabase(app);
    return {
      status: "ok",
      database,
      version: process.env["npm_package_version"] ?? "0.1.0",
      time: new Date().toISOString(),
    };
  });
}
