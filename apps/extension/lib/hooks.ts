import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import type { PostuliaSettings } from "./settings";
import {
  db,
  type LocalApplication,
  type LocalEvent,
  type LocalReminder,
  type LocalTag,
} from "./db";
import { sendMessage, type ExtensionStatus } from "./messaging";

export function useApplications(): LocalApplication[] | undefined {
  return useLiveQuery(
    async () => {
      const applications = await db.applications.filter((item) => !item.deletedAt).toArray();
      return applications.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    [],
    undefined,
  );
}

export function useApplication(id: string | null | undefined): LocalApplication | undefined {
  return useLiveQuery(
    async () => (id ? await db.applications.get(id) : undefined),
    [id],
    undefined,
  );
}

export function useEvents(applicationId: string | null | undefined): LocalEvent[] {
  return (
    useLiveQuery(
      async () => {
        if (!applicationId) return [];
        const events = await db.events
          .where("applicationId")
          .equals(applicationId)
          .filter((event) => !event.deletedAt)
          .toArray();
        return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      },
      [applicationId],
      [],
    ) ?? []
  );
}

export function useReminders(
  options: { applicationId?: string | null; pendingOnly?: boolean } = {},
): LocalReminder[] {
  const { applicationId, pendingOnly } = options;
  return (
    useLiveQuery(
      async () => {
        const reminders = applicationId
          ? await db.reminders.where("applicationId").equals(applicationId).toArray()
          : await db.reminders.toArray();

        return reminders
          .filter((reminder) => !reminder.deletedAt && (!pendingOnly || !reminder.done))
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      },
      [applicationId, pendingOnly],
      [],
    ) ?? []
  );
}

export function useTags(): LocalTag[] {
  return (
    useLiveQuery(
      async () => {
        const tags = await db.tags.filter((tag) => !tag.deletedAt).toArray();
        return tags.sort((a, b) => a.name.localeCompare(b.name));
      },
      [],
      [],
    ) ?? []
  );
}

export function useSettingsRow(): PostuliaSettings | null | undefined {
  return useLiveQuery(
    async () => {
      const row = await db.meta.get("settings");
      return (row?.value as PostuliaSettings) ?? null;
    },
    [],
    undefined,
  );
}

/** Consulta el estado global (sync, sesión, pendientes) al service worker. */
export function useExtensionStatus(pollMs = 15_000): {
  status: ExtensionStatus | null;
  refresh: () => void;
  syncing: boolean;
  syncNow: () => Promise<void>;
} {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    void sendMessage<ExtensionStatus>({ type: "postulia:status" })
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await sendMessage({ type: "postulia:sync-now" });
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollMs, refresh]);

  return { status, refresh, syncing, syncNow };
}
