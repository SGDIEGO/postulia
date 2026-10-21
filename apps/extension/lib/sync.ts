import type { Table } from "dexie";
import {
  nowIso,
  type SyncPullResult,
  type SyncPushPayload,
  type SyncPushResult,
} from "@postulia/shared";
import { ApiError, apiRequest } from "./api";
import { db } from "./db";
import { getSettings, hasSession, updateSettings } from "./settings";

export interface SyncReport {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  at: string;
  error?: string;
  skipped?: string;
}

function stripLocal<T extends { dirty?: 1 }>(record: T): Omit<T, "dirty"> {
  const { dirty: _dirty, ...rest } = record;
  return rest;
}

/**
 * Escribe un registro remoto en la base local respetando los cambios locales
 * más recientes (last write wins).
 */
async function mergeInto<T extends { id: string; updatedAt: string; dirty?: 1 }>(
  table: Table<T, string>,
  remote: T,
): Promise<boolean> {
  const local = await table.get(remote.id);
  if (local) {
    if (local.updatedAt > remote.updatedAt) return false;
    if (local.updatedAt === remote.updatedAt && local.dirty) return false;
  }
  await table.put({ ...remote, dirty: undefined });
  return true;
}

export async function pushLocalChanges(): Promise<{
  pushed: number;
  conflicts: number;
  result: SyncPushResult | null;
}> {
  const [applications, events, reminders, tags] = await Promise.all([
    db.applications.where("dirty").equals(1).toArray(),
    db.events.where("dirty").equals(1).toArray(),
    db.reminders.where("dirty").equals(1).toArray(),
    db.tags.where("dirty").equals(1).toArray(),
  ]);

  if (
    applications.length === 0 &&
    events.length === 0 &&
    reminders.length === 0 &&
    tags.length === 0
  ) {
    return { pushed: 0, conflicts: 0, result: null };
  }

  const payload: SyncPushPayload = {
    applications: applications.map(stripLocal),
    events: events.map(stripLocal),
    reminders: reminders.map(stripLocal),
    tags: tags.map(stripLocal),
    clientTime: nowIso(),
  };

  const result = await apiRequest<SyncPushResult>("/api/sync/push", {
    method: "POST",
    body: payload,
  });

  let conflicts = 0;

  await db.transaction("rw", db.applications, db.events, db.reminders, db.tags, async () => {
    for (const id of result.applied.applications) {
      await db.applications.update(id, { dirty: undefined });
    }
    for (const id of result.applied.events) {
      await db.events.update(id, { dirty: undefined });
    }
    for (const id of result.applied.reminders) {
      await db.reminders.update(id, { dirty: undefined });
    }
    for (const id of result.applied.tags) {
      await db.tags.update(id, { dirty: undefined });
    }

    for (const remote of result.conflicts.applications) {
      conflicts += 1;
      await mergeInto(db.applications, remote);
    }
    for (const remote of result.conflicts.events) {
      conflicts += 1;
      await mergeInto(db.events, remote);
    }
    for (const remote of result.conflicts.reminders) {
      conflicts += 1;
      await mergeInto(db.reminders, remote);
    }
    for (const remote of result.conflicts.tags) {
      conflicts += 1;
      await mergeInto(db.tags, remote);
    }
  });

  return {
    pushed:
      result.applied.applications.length +
      result.applied.events.length +
      result.applied.reminders.length +
      result.applied.tags.length,
    conflicts,
    result,
  };
}

export async function pullRemoteChanges(): Promise<number> {
  const settings = await getSettings();
  const since = settings.lastPulledAt ?? new Date(0).toISOString();
  const result = await apiRequest<SyncPullResult>(
    `/api/sync/pull?since=${encodeURIComponent(since)}`,
  );

  let applied = 0;

  await db.transaction("rw", db.applications, db.events, db.reminders, db.tags, async () => {
    for (const remote of result.applications) {
      if (await mergeInto(db.applications, remote)) applied += 1;
    }
    for (const remote of result.events) {
      if (await mergeInto(db.events, remote)) applied += 1;
    }
    for (const remote of result.reminders) {
      if (await mergeInto(db.reminders, remote)) applied += 1;
    }
    for (const remote of result.tags) {
      if (await mergeInto(db.tags, remote)) applied += 1;
    }
  });

  await updateSettings({ lastPulledAt: result.serverTime });
  return applied;
}

export async function syncNow(): Promise<SyncReport> {
  const settings = await getSettings();
  const at = nowIso();

  if (!settings.apiUrl) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, at, skipped: "sin_api" };
  }
  if (!settings.syncEnabled) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, at, skipped: "desactivada" };
  }
  if (!hasSession(settings)) {
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, at, skipped: "sin_sesion" };
  }

  try {
    const { pushed, conflicts } = await pushLocalChanges();
    const pulled = await pullRemoteChanges();
    await updateSettings({ lastSyncAt: at, lastSyncError: null });
    return { ok: true, pushed, pulled, conflicts, at };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Error desconocido al sincronizar";
    await updateSettings({ lastSyncError: message, lastSyncAt: at });
    return { ok: false, pushed: 0, pulled: 0, conflicts: 0, at, error: message };
  }
}
