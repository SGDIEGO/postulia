import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { SYNC_DEFAULTS, type ApplicationStatus } from "@postulia/shared";
import { db } from "~/lib/db";
import { apiRequest } from "~/lib/api";
import { checkDueReminders, remindersSummary } from "~/lib/notifications";
import { discoveryService } from "~/lib/discovery/service.js";
import {
  createApplication,
  changeStatus,
  findDuplicateByUrl,
  pendingChangesCount,
  updateApplication,
} from "~/lib/repository";
import { getSettings, hasSession } from "~/lib/settings";
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
const DISCOVERY_ALARM = "postulia:discovery:alerts";
const DISCOVERY_CLEANUP_ALARM = "postulia:discovery:cleanup";

async function scheduleAlarms(): Promise<void> {
  const settings = await getSettings();

  await browser.alarms.create(REMINDER_ALARM, { periodInMinutes: 30 });

  // Las alertas y la limpieza del descubrimiento son funciones locales: deben
  // programarse siempre, haya o no sesión de sincronización.
  await browser.alarms.create(DISCOVERY_ALARM, { periodInMinutes: 60 * 24 }); // diario
  await browser.alarms.create(DISCOVERY_CLEANUP_ALARM, { periodInMinutes: 60 * 24 }); // diario

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
    if (alarm.name === DISCOVERY_ALARM) void discoveryService.runAlerts();
    if (alarm.name === DISCOVERY_CLEANUP_ALARM) void discoveryService.cleanup();
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const request = message as BackgroundRequest;
    const type = request?.type;

    // Solo respondemos mensajes dirigidos al background. Los content
    // scripts tienen sus propios listeners para la captura.
    if (
      typeof type !== "string" ||
      (!type.startsWith("postulia:") && !type.startsWith("discovery:"))
    ) {
      return false;
    }

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

        case "postulia:alarms:reschedule": {
          await scheduleAlarms();
          return { ok: true };
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

        // Discovery handlers
        case "discovery:search": {
          const result = await discoveryService.search({
            query: request.query,
            filters: request.filters,
            source: request.source,
            page: request.page,
            pageSize: request.pageSize,
          });
          return result;
        }

        case "discovery:list": {
          const result = await discoveryService.list({
            query: request.query,
            source: request.source,
            filters: request.filters,
            page: request.page,
            pageSize: request.pageSize,
          });
          return result;
        }

        case "discovery:action": {
          await discoveryService.performAction({
            jobId: request.jobId,
            action: request.action,
            reminderDays: request.reminderDays,
          });
          return { ok: true };
        }

        case "discovery:history": {
          const history = await discoveryService.getHistory();
          return history;
        }

        case "discovery:alert:create": {
          const alert = await discoveryService.createAlert(request.alert);
          return alert;
        }

        case "discovery:alert:list": {
          const alerts = await discoveryService.listAlerts();
          return alerts;
        }

        case "discovery:alert:toggle": {
          await discoveryService.toggleAlert(request.id, request.enabled);
          return { ok: true };
        }

        case "discovery:alert:delete": {
          await discoveryService.deleteAlert(request.id);
          return { ok: true };
        }

        case "discovery:run-alerts": {
          return discoveryService.runAlerts();
        }

        default:
          return undefined;
      }
    };

    void respond()
      .then((result) => {
        sendResponse(result === undefined ? { error: "Acción no soportada" } : result);
      })
      .catch((error: unknown) => {
        console.error(`[Postulia] Error en ${type}:`, error);
        sendResponse({ error: error instanceof Error ? error.message : "Error interno" });
      });
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
});
