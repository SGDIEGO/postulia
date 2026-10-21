import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Prisma, type PrismaClient } from "@prisma/client";
import { loadEnv, type Env } from "./env.js";
import { HttpError, badRequest } from "./lib/errors.js";
import { authPlugin } from "./plugins/auth.js";
import { prismaPlugin } from "./plugins/prisma.js";
import applicationsRoutes from "./routes/applications.js";
import authRoutes from "./routes/auth.js";
import healthRoutes from "./routes/health.js";
import remindersRoutes from "./routes/reminders.js";
import statsRoutes from "./routes/stats.js";
import syncRoutes from "./routes/sync.js";
import tagsRoutes from "./routes/tags.js";

export interface BuildAppOptions {
  env?: Env;
  /** Cliente Prisma alternativo (usado en las pruebas). */
  prisma?: PrismaClient;
  logger?: FastifyServerOptions["logger"];
}

/** Comprueba el origen de una petición contra CORS_ORIGINS. */
function buildOriginChecker(env: Env) {
  const patterns = env.CORS_ORIGINS.split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed = patterns.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern === origin) return true;
      if (pattern.endsWith("/*")) return origin.startsWith(pattern.slice(0, -1));
      if (pattern.startsWith("chrome-extension://") && pattern.includes("*")) {
        return origin.startsWith("chrome-extension://");
      }
      return false;
    });

    callback(null, allowed);
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    logger: options.logger ?? (env.NODE_ENV === "test" ? false : { level: env.LOG_LEVEL }),
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  app.decorate("env", env);

  await app.register(cors, {
    origin: buildOriginChecker(env) as unknown as FastifyCorsOptions["origin"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });

  await app.register(prismaPlugin, { prisma: options.prisma });
  await app.register(authPlugin, { secret: env.JWT_SECRET });

  app.setErrorHandler((errorRaw, request, reply) => {
    const error = errorRaw as Error & { statusCode?: number; validation?: unknown; code?: string };

    if (error instanceof HttpError) {
      reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details });
      return;
    }

    if (errorRaw instanceof Prisma.PrismaClientKnownRequestError) {
      if (errorRaw.code === "P2002") {
        reply.code(409).send({ error: "conflict", message: "El registro ya existe" });
        return;
      }
      if (errorRaw.code === "P2025") {
        reply.code(404).send({ error: "not_found", message: "El registro no existe" });
        return;
      }
    }

    if (error.validation) {
      const details = badRequest("Datos inválidos", error.validation).details;
      reply.code(400).send({ error: "bad_request", message: "Datos inválidos", details });
      return;
    }

    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Error no controlado");
    }
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_error",
      message: statusCode >= 500 ? "Ocurrió un error inesperado" : error.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: "not_found",
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(applicationsRoutes);
  await app.register(remindersRoutes);
  await app.register(tagsRoutes);
  await app.register(syncRoutes);
  await app.register(statsRoutes);

  return app;
}
