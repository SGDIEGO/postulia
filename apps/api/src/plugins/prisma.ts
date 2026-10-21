import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  /** Permite inyectar un cliente falso en las pruebas. */
  prisma?: PrismaClient;
}

export const prismaPlugin = fp<PrismaPluginOptions>(async (app, options) => {
  const external = options.prisma;
  const prisma =
    external ??
    new PrismaClient({
      log: app.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
    });

  if (!external) {
    try {
      await prisma.$connect();
      app.log.info("PostgreSQL conectado");
    } catch (error) {
      app.log.error(
        { err: error },
        "No se pudo conectar a PostgreSQL al iniciar; las consultas fallarán hasta que la base esté disponible",
      );
    }
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  }

  app.decorate("prisma", prisma);
});

/** Comprueba la conexión a la base de datos (usado por /health). */
export async function checkDatabase(app: FastifyInstance): Promise<"up" | "down"> {
  try {
    await app.prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}
