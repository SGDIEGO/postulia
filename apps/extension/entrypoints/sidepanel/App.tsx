import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  LayoutDashboard,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  STATUS_LABELS,
  formatDateEs,
  relativeTimeEs,
  type ApplicationStatus,
} from "@postulia/shared";
import { StatusBadge } from "~/components/StatusBadge";
import { Button, Spinner, cn } from "~/components/ui";
import { useApplications, useExtensionStatus, useReminders } from "~/lib/hooks";
import type { ExtractedJobResult } from "~/lib/extractors/types";
import {
  sendMessage,
  type CaptureResponse,
  type DuplicateResponse,
  type ExtensionStatus,
} from "~/lib/messaging";

type CaptureState =
  | { stage: "loading" }
  | { stage: "empty"; message: string }
  | { stage: "ready"; job: ExtractedJobResult; duplicate: boolean }
  | { stage: "saved"; title: string }
  | { stage: "error"; message: string };

/**
 * Pide la extracción al content script. Si la página no está entre los
 * portales compatibles, lo inyecta con activeTab (el clic en la acción de la
 * extensión concede permiso temporal para la pestaña activa).
 */
async function extractFromTab(tabId: number): Promise<ExtractedJobResult | null | undefined> {
  try {
    return (await browser.tabs.sendMessage(tabId, {
      type: "postulia:extract",
    })) as ExtractedJobResult | null;
  } catch {
    // Sin content script: se inyecta en la pestaña actual.
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (await browser.tabs.sendMessage(tabId, {
      type: "postulia:extract",
    })) as ExtractedJobResult | null;
  } catch {
    return undefined;
  }
}

export function SidePanelApp() {
  const [capture, setCapture] = useState<CaptureState>({ stage: "loading" });
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [notes, setNotes] = useState("");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const applications = useApplications() ?? [];
  const reminders = useReminders({ pendingOnly: true }).slice(0, 3);
  const { status: extensionStatus, syncing, syncNow } = useExtensionStatus(10_000);

  const detect = useCallback(async () => {
    setCapture({ stage: "loading" });
    setNotes("");
    setStatus("applied");

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) {
        setCapture({ stage: "empty", message: "No hay una pestaña activa." });
        return;
      }
      setActiveTabId(tab.id);

      const extracted = await extractFromTab(tab.id);

      if (extracted === undefined) {
        setCapture({
          stage: "empty",
          message:
            "No se pudo acceder a esta página. Abre una oferta y pulsa el icono de Postulia en la barra de Chrome para activar la captura en este sitio.",
        });
        return;
      }

      if (extracted === null) {
        setCapture({
          stage: "empty",
          message:
            "Esta página no parece una oferta. Si el portal no es compatible, abre la vacante y vuelve a pulsar el icono de Postulia.",
        });
        return;
      }

      const duplicate = await sendMessage<DuplicateResponse>({
        type: "postulia:duplicate-check",
        url: extracted.url,
      }).catch(() => ({ duplicate: false }) as DuplicateResponse);

      setCapture({ stage: "ready", job: extracted, duplicate: duplicate.duplicate });
    } catch {
      setCapture({
        stage: "empty",
        message: "No se pudo leer esta página. Recarga la pestaña y vuelve a intentar.",
      });
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  useEffect(() => {
    const onFocus = () => void detect();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [detect]);

  async function save(force = false) {
    if (capture.stage !== "ready") return;
    const job = capture.job;
    const response = await sendMessage<CaptureResponse>({
      type: "postulia:capture",
      payload: {
        ...job,
        status,
        notes: notes.trim() || null,
        force,
      },
    }).catch<CaptureResponse>(() => ({ ok: false, error: "No se pudo guardar" }));

    if (response.ok) {
      setCapture({ stage: "saved", title: `${job.jobTitle} · ${job.company}` });
      return;
    }

    if ("duplicate" in response && response.duplicate) {
      setCapture({ stage: "ready", job, duplicate: true });
      return;
    }

    setCapture({
      stage: "error",
      message: "error" in response ? response.error : "No se pudo guardar la postulación",
    });
  }

  async function openDashboard(path: `/dashboard.html${string}` = "/dashboard.html") {
    await browser.tabs.create({ url: browser.runtime.getURL(path) });
  }

  const pending = extensionStatus?.pending ?? 0;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BriefcaseBusiness size={16} />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">Postulia</p>
            <SyncLine status={extensionStatus} pending={pending} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void syncNow()}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            title="Sincronizar ahora"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : undefined} />
          </button>
          <button
            type="button"
            onClick={() => void openDashboard("/dashboard.html?tab=settings")}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            title="Ajustes"
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto p-3">
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Capturar oferta
            </h2>
            <button
              type="button"
              onClick={() => void detect()}
              className="text-[11px] font-medium text-brand-600 hover:underline"
            >
              Volver a detectar
            </button>
          </div>

          {capture.stage === "loading" && <Spinner label="Leyendo la pestaña…" />}

          {capture.stage === "empty" && <p className="text-xs text-slate-500">{capture.message}</p>}

          {capture.stage === "error" && <p className="text-xs text-rose-600">{capture.message}</p>}

          {capture.stage === "saved" && (
            <div className="space-y-2">
              <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                <Check size={14} className="mt-0.5 shrink-0" />
                Guardado: {capture.title}
              </p>
              <Button size="sm" className="w-full" onClick={() => void openDashboard()}>
                <LayoutDashboard size={14} /> Abrir Postulia
              </Button>
            </div>
          )}

          {capture.stage === "ready" && (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold leading-tight text-slate-800">
                  {capture.job.jobTitle ?? "Oferta sin título"}
                </p>
                <p className="text-xs text-slate-500">
                  {capture.job.company ?? "Empresa sin especificar"}
                  {capture.job.location ? ` · ${capture.job.location}` : ""}
                </p>
              </div>

              {capture.duplicate && (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  Ya tienes esta oferta guardada. Puedes actualizar su estado o guardarla de nuevo.
                </p>
              )}

              <div>
                <p className="mb-1 text-[11px] font-medium text-slate-500">Estado</p>
                <div className="flex flex-wrap gap-1">
                  {(["saved", "applied", "screening", "interview"] as ApplicationStatus[]).map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setStatus(option)}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          status === option
                            ? "bg-brand-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                        )}
                      >
                        {STATUS_LABELS[option]}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Nota rápida (opcional)"
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
              />

              <Button size="sm" className="w-full" onClick={() => void save(capture.duplicate)}>
                {capture.duplicate ? "Actualizar estado y guardar" : "Guardar postulación"}
              </Button>
            </div>
          )}
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recientes
            </h2>
            <button
              type="button"
              onClick={() => void openDashboard()}
              className="text-[11px] font-medium text-brand-600 hover:underline"
            >
              Ver todas
            </button>
          </div>

          {applications.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-400">
              Sin postulaciones todavía.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {applications.slice(0, 6).map((application) => (
                <li key={application.id}>
                  <button
                    type="button"
                    onClick={() => void openDashboard(`/dashboard.html?app=${application.id}`)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {application.jobTitle}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {application.company}
                      </span>
                    </span>
                    <StatusBadge status={application.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Seguimientos
            </h2>
            <button
              type="button"
              onClick={() => void openDashboard("/dashboard.html?tab=reminders")}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-600 hover:underline"
            >
              Ver todos <ArrowUpRight size={11} />
            </button>
          </div>

          {reminders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs text-slate-400">
              Sin recordatorios pendientes.
            </p>
          ) : (
            <ul className="space-y-1">
              {reminders.map((reminder) => {
                const application = applications.find((item) => item.id === reminder.applicationId);
                const overdue = new Date(reminder.dueAt).getTime() < Date.now();
                return (
                  <li key={reminder.id}>
                    <button
                      type="button"
                      onClick={() =>
                        application && void openDashboard(`/dashboard.html?app=${application.id}`)
                      }
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left hover:border-brand-300"
                    >
                      <CalendarClock
                        size={13}
                        className={overdue ? "shrink-0 text-rose-500" : "shrink-0 text-amber-500"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-slate-700">
                          {application?.company ?? "Postulación"}
                        </span>
                        <span
                          className={cn(
                            "block text-[10px]",
                            overdue ? "text-rose-600" : "text-slate-400",
                          )}
                        >
                          {formatDateEs(reminder.dueAt)} · {relativeTimeEs(reminder.dueAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => void openDashboard()}
        >
          <LayoutDashboard size={14} /> Abrir dashboard completo
        </Button>
      </footer>
    </div>
  );
}

function SyncLine({ status, pending }: { status: ExtensionStatus | null; pending: number }) {
  if (!status) return <p className="text-[10px] text-slate-400">Cargando…</p>;
  if (!status.loggedIn) {
    return (
      <p className="text-[10px] text-slate-400">
        {status.apiUrl ? "Sin sesión" : "Solo local"} · {pending} pendiente(s)
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[10px] text-slate-400">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status.lastSyncError ? "bg-rose-500" : "bg-emerald-500",
        )}
      />
      {status.email ?? "Conectado"} · {pending} pendiente(s)
    </p>
  );
}
