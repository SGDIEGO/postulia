import Dexie, { type Table } from "dexie";
import type {
  ApplicationRecord,
  ApplicationEventRecord,
  ReminderRecord,
  TagRecord,
  Source,
  WorkMode,
  DiscoveredJob,
  SearchHistory,
  SearchAlert,
  SearchFilters,
} from "@postulia/shared";

/** `1` cuando el registro tiene cambios locales pendientes de subir. */
export type SyncFlag = 1 | undefined;

export interface LocalApplication extends ApplicationRecord {
  dirty?: SyncFlag;
}

export interface LocalEvent extends ApplicationEventRecord {
  dirty?: SyncFlag;
}

export interface LocalReminder extends ReminderRecord {
  dirty?: SyncFlag;
}

export interface LocalTag extends TagRecord {
  dirty?: SyncFlag;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class PostuliaDatabase extends Dexie {
  applications!: Table<LocalApplication, string>;
  events!: Table<LocalEvent, string>;
  reminders!: Table<LocalReminder, string>;
  tags!: Table<LocalTag, string>;
  meta!: Table<MetaRow, string>;
  jobDiscoveries!: Table<DiscoveredJob, string>;
  searchHistory!: Table<SearchHistory, string>;
  searchAlerts!: Table<SearchAlert, string>;

  constructor() {
    super("postulia");
    this.version(1).stores({
      applications: "id, status, company, source, appliedAt, updatedAt, urlHash, dirty",
      events: "id, applicationId, type, occurredAt, updatedAt, dirty",
      reminders: "id, applicationId, dueAt, done, updatedAt, dirty",
      tags: "id, name, updatedAt, dirty",
      meta: "key",
    });

    this.version(2)
      .stores({
        jobDiscoveries:
          "id, source, searchQuery, scrapedAt, urlHash, userAction, reminderAt, expiresAt",
        searchHistory: "id, query, executedAt, source",
        searchAlerts: "id, query, enabled, frequency, lastRunAt",
      })
      .upgrade(async (tx) => {
        // Migración automática: las tablas nuevas se crean vacías
        // No hay datos que migrar de v1
      });

    this.version(3)
      .stores({
        jobDiscoveries:
          "id, source, searchQuery, scrapedAt, urlHash, userAction, reminderAt, expiresAt",
      })
      .upgrade(async (tx) => {
        // Las ofertas guardadas antes de registrar el origen podían heredar la
        // modalidad del filtro de búsqueda. Se limpian para no mostrar un dato
        // que no procede de la oferta.
        await tx
          .table<DiscoveredJob>("jobDiscoveries")
          .toCollection()
          .modify((job) => {
            if (!job.workModeSource) {
              delete job.workMode;
              job.workModeSource = "unknown";
              job.workModeConfidence = "low";
            }
          });
      });
  }
}

export const db = new PostuliaDatabase();

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await db.meta.get(key);
  return (row?.value as T) ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value, updatedAt: new Date().toISOString() });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}
