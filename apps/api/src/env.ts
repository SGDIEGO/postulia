import { z } from "zod";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
  }
}

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value.toLowerCase() !== "false"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  CORS_ORIGINS: z.string().default("chrome-extension://*"),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  ALLOW_REGISTRATION: booleanFromString(true),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  /** Base pública para los enlaces del correo. Vacío = se deduce de la petición. */
  PUBLIC_URL: z.string().default(""),
  /** Minutos que vive el enlace de verificación de correo. */
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  /** Interruptor de despliegue: permite desactivar la verificación sin desplegar. */
  REQUIRE_EMAIL_VERIFICATION: booleanFromString(true),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración inválida, revisa tu archivo .env:\n${issues}`);
  }
  return parsed.data;
}

/** Orígenes permitidos para CORS a partir de la variable CORS_ORIGINS. */
export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export async function decorateEnv(app: FastifyInstance, env: Env): Promise<void> {
  app.decorate("env", env);
}
