import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { SYNC_DEFAULTS, type ApplicationStatus } from "@postulia/shared";
import { db } from "~/lib/db";
import { apiRequest, ApiError } from "~/lib/api";
import { checkDueReminders, remindersSummary } from "~/lib/notifications";
import {
  createApplication,
  changeStatus,
  findDuplicateByUrl,
  pendingChangesCount,
  updateApplication,
} from "~/lib/repository";
import { getSettings, hasSession, updateSettings } from "~/lib/settings";
import { syncNow } from "~/lib/sync";
import type {
  BackgroundRequest,
  CapturePayload,
  CaptureResponse,
  DuplicateResponse,
  ExtensionStatus,
} from "~/lib/messaging";

const SYNC_ALARM = "postulia:sync";
const REMINDER_ALARM = "postulia:reminders";

async function scheduleAlarms(): Promise<void> {
  const settings = await getSettings();

  await browser.alarms.create(REMINDER_ALARM, { periodInMinutes: 30 });

  if (settings.syncEnabled && hasSession(settings)) {
    await browser.alarms.create(SYNC_ALARM, {
      periodInMinutes: SYNC_DEFAULTS.intervalMinutes,
    });
  } else {
    await browser.alarms.clear(SYNC_ALARM);
  }
}

async function captureApplication(payload: CapturePayload): Promise<CaptureResponse> {
  try {
    const duplicate = payload.url ? await findDuplicateByUrl(payload.url) : null;
    if (duplicate && !payload.force) {
      return { ok: false, duplicate: true, application: duplicate };
    }

    const application = await createApplication({
      jobTitle: payload.jobTitle ?? "Oferta sin título",
      company: payload.company ?? "Empresa sin especificar",
      url: payload.url,
      source: payload.source,
      location: payload.location,
      workMode: payload.workMode,
      salary: payload.salary,
      currency: payload.currency,
      contractType: payload.contractType,
      status: payload.status,
      appliedAt: null,
      notes: payload.notes ?? null,
      recruiterName: null,
      recruiterContact: null,
      cvVersion: null,
      tags: [],
    });

    if (payload.notes) {
      await updateApplication(application.id, { notes: payload.notes });
    }

    void syncNow();
    return { ok: true, application };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo guardar la postulación",
    };
  }
}

async function duplicateCheck(url: string): Promise<DuplicateResponse> {
  const local = await findDuplicateByUrl(url);
  if (local) return { duplicate: true, application: local, origin: "local" };

  const settings = await getSettings();
  if (!hasSession(settings)) return { duplicate: false };

  try {
    const result = await apiRequest<{
      duplicate: boolean;
      application: typeof local | null;
    }>(`/api/applications/lookup?url=${encodeURIComponent(url)}`);

    if (result.duplicate && result.application) {
      return { duplicate: true, application: result.application, origin: "remoto" };
    }
  } catch {
    // Sin conexión: nos quedamos con lo local
  }

  return { duplicate: false };
}

async function buildStatus(): Promise<ExtensionStatus> {
  const settings = await getSettings();
  const [pending, total, reminders] = await Promise.all([
    pendingChangesCount(),
    db.applications.filter((item) => !item.deletedAt).count(),
    remindersSummary(),
  ]);

  return {
    apiUrl: settings.apiUrl,
    loggedIn: hasSession(settings),
    email: settings.user?.email ?? null,
    pending,
    lastSyncAt: settings.lastSyncAt,
    lastSyncError: settings.lastSyncError,
    totalApplications: total,
    reminders,
  };
}

export default defineBackground(() => {
  const sidePanel = (
    browser as unknown as {
      sidePanel?: {
        setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
      };
    }
  ).sidePanel;

  browser.runtime.onInstalled.addListener((details) => {
    void sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
    void scheduleAlarms();
    if (details.reason === "install") {
      void browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
    }
  });

  browser.runtime.onStartup?.addListener(() => {
    void scheduleAlarms();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncNow();
    if (alarm.name === REMINDER_ALARM) void checkDueReminders();
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const request = message as BackgroundRequest;

    const respond = async (): Promise<unknown> => {
      switch (request?.type) {
        case "postulia:sync-now":
          return syncNow();

        case "postulia:status":
          return buildStatus();

        case "postulia:capture":
          return captureApplication(request.payload);

        case "postulia:update-status": {
          const updated = await changeStatus(request.id, request.status as ApplicationStatus);
          void syncNow();
          return { ok: Boolean(updated) };
        }

        case "postulia:duplicate-check":
          return duplicateCheck(request.url);

        case "postulia:open-dashboard":
          await browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
          return { ok: true };

        case "postulia:check-reminders": {
          const count = await checkDueReminders();
          return { notified: count };
        }

        case "postulia:open-sidepanel": {
          const tabId = sender?.tab?.id;
          const open = (
            sidePanel as { open?: (options: { tabId?: number }) => Promise<void> } | undefined
          )?.open;
          if (open && tabId) {
            try {
              await open({ tabId });
              return { ok: true };
            } catch {
              // continúa con el dashboard
            }
          }
          await browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
          return { ok: false, fallback: "dashboard" };
        }

        default:
          return undefined;
      }
    };

    void respond().then(sendResponse);
    return true;
  });

  /* Sincroniza al arrancar si hay sesión configurada. */
  void (async () => {
    await scheduleAlarms();
    const settings = await getSettings();
    if (settings.syncEnabled && hasSession(settings)) {
      await syncNow();
    }
  })();

  /* Avisa en el log si el token dejó de ser válido. */
  void (async () => {
    try {
      const settings = await getSettings();
      if (settings.apiUrl && settings.refreshToken && !settings.user) {
        await updateSettings({ lastSyncError: "Vuelve a iniciar sesión para sincronizar" });
      }
    } catch (error) {
      if (error instanceof ApiError) console.warn("Postulia:", error.message);
    }
  })();
});
