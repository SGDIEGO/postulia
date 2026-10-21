import Dexie, { type Table } from "dexie";
import type {
  ApplicationRecord,
  ApplicationEventRecord,
  ReminderRecord,
  TagRecord,
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

  constructor() {
    super("postulia");
    this.version(1).stores({
      applications: "id, status, company, source, appliedAt, updatedAt, urlHash, dirty",
      events: "id, applicationId, type, occurredAt, updatedAt, dirty",
      reminders: "id, applicationId, dueAt, done, updatedAt, dirty",
      tags: "id, name, updatedAt, dirty",
      meta: "key",
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
