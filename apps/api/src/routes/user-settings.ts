import type { FastifyInstance } from "fastify";
import { userSettingsPatchSchema, type UserSettings } from "@postulia/shared";
import { badRequest } from "../lib/errors.js";

const DEFAULT_USER_SETTINGS = {
  syncEnabled: true,
  notificationsEnabled: true,
  emailNotificationsEnabled: true,
  followUpDays: 7,
} as const;

function toUserSettings(row: UserSettings): UserSettings {
  return {
    syncEnabled: row.syncEnabled,
    notificationsEnabled: row.notificationsEnabled,
    emailNotificationsEnabled: row.emailNotificationsEnabled,
    followUpDays: row.followUpDays,
  };
}

/**
 * Preferencias de la cuenta: viajan con el usuario y se cargan al iniciar
 * sesión en cualquier equipo.
 */
export default async function userSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  /** Devuelve las preferencias y crea la fila con valores por defecto si falta. */
  app.get("/api/users/settings", async (request) => {
    const userId = request.user.sub;
    const row = await app.prisma.userSettings.upsert({
      where: { userId },
      update: {},
      create: { userId, ...DEFAULT_USER_SETTINGS },
    });

    return toUserSettings(row);
  });

  /** Actualiza solo los campos enviados (upsert si la fila aún no existe). */
  app.put("/api/users/settings", async (request) => {
    const parsed = userSettingsPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const userId = request.user.sub;
    const row = await app.prisma.userSettings.upsert({
      where: { userId },
      update: parsed.data,
      create: { userId, ...DEFAULT_USER_SETTINGS, ...parsed.data },
    });

    return toUserSettings(row);
  });
}
