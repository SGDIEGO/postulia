import { z } from "zod";
import {
  applicationSyncSchema,
  eventSyncSchema,
  reminderSyncSchema,
  tagSyncSchema,
} from "./application.js";

/** Lote de cambios locales que se envían al servidor. */
export const syncPushSchema = z.object({
  applications: z.array(applicationSyncSchema).max(500).default([]),
  events: z.array(eventSyncSchema).max(2000).default([]),
  reminders: z.array(reminderSyncSchema).max(500).default([]),
  tags: z.array(tagSyncSchema).max(500).default([]),
  clientTime: z.string().optional(),
});

export type SyncPushPayload = z.infer<typeof syncPushSchema>;

export interface SyncPushResult {
  serverTime: string;
  applied: {
    applications: string[];
    events: string[];
    reminders: string[];
    tags: string[];
  };
  /**
   * Registros donde la versión del servidor era más reciente y ganó el
   * "last write wins". La extensión los sobrescribe con lo devuelto aquí.
   */
  conflicts: {
    applications: z.infer<typeof applicationSyncSchema>[];
    events: z.infer<typeof eventSyncSchema>[];
    reminders: z.infer<typeof reminderSyncSchema>[];
    tags: z.infer<typeof tagSyncSchema>[];
  };
}

export interface SyncPullResult {
  serverTime: string;
  applications: z.infer<typeof applicationSyncSchema>[];
  events: z.infer<typeof eventSyncSchema>[];
  reminders: z.infer<typeof reminderSyncSchema>[];
  tags: z.infer<typeof tagSyncSchema>[];
}

export const SYNC_DEFAULTS = {
  /** Cada cuántos minutos se intenta sincronizar en segundo plano. */
  intervalMinutes: 5,
  /** Reintentos con backoff exponencial ante fallos (en minutos). */
  backoffMinutes: [1, 2, 5, 15, 30, 60],
  /** Máximo de registros por lote de push. */
  batchSize: 200,
} as const;
