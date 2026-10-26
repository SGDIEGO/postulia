import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  faArrowRight,
  faArrowsRotate,
  faBan,
  faBell,
  faBriefcase,
  faBuilding,
  faCalendarCheck,
  faCamera,
  faCircleCheck,
  faCircleInfo,
  faCompass,
  faGear,
  faHouse,
  faMagnifyingGlass,
  faShuffle,
  faTableColumns,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  formatDateEs,
  relativeTimeEs,
  type ApplicationStatus,
  type Source,
  type SearchFilters,
  type DiscoveryAction,
  type DiscoverySearchResult,
  type DiscoveredJob,
} from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { StatusBadge } from "~/components/StatusBadge";
import { Button, Spinner, cn } from "~/components/ui";
import { useApplications, useExtensionStatus, useReminders } from "~/lib/hooks";
import { isLocationFilterActive, resolveCountry } from "~/lib/discovery/location";
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

type SidePanelTab = "capture" | "discover";

const DISCOVER_PAGE_SIZE = 20;

const WORK_MODE_ICONS = {
  remote: faHouse,
  hybrid: faShuffle,
  onsite: faBuilding,
} as const;

const CONFIDENCE_LABELS = {
  high: "Confianza alta",
  medium: "Confianza media",
  low: "Confianza baja",
} as const;

function workModeHint(source?: string, confidence?: "high" | "medium" | "low"): string {
  const origin =
    source === "portal"
      ? "Modalidad indicada por el portal"
      : source === "jsonld"
        ? "Modalidad indicada en los datos estructurados"
        : source === "text"
          ? "Modalidad deducida del título o la ubicación"
          : "Origen de la modalidad no registrado";
  return confidence ? `${origin} · ${CONFIDENCE_LABELS[confidence]}` : origin;
}

export function SidePanelApp() {
  const [activeTab, setActiveTab] = useState<SidePanelTab>("capture");
  const [capture, setCapture] = useState<CaptureState>({ stage: "loading" });
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [notes, setNotes] = useState("");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // Discover state
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverFilters, setDiscoverFilters] = useState<SearchFilters>({
    location: "Bogotá",
    workMode: undefined,
    postedWithinDays: 7,
  });
  const [discoverSource, setDiscoverSource] = useState<Source | "all">("all");
  const [discoverResults, setDiscoverResults] = useState<DiscoveredJob[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverWarnings, setDiscoverWarnings] = useState<string[]>([]);
  const [discoverHiddenUnknown, setDiscoverHiddenUnknown] = useState(0);
  const [discoverHiddenUnknownLocation, setDiscoverHiddenUnknownLocation] = useState(0);
  const [discoverPage, setDiscoverPage] = useState(1);
  const [discoverTotal, setDiscoverTotal] = useState(0);
  const [discoverHistory, setDiscoverHistory] = useState<
    Array<{ query: string; executedAt: string; resultCount: number }>
  >([]);
  const [showHistory, setShowHistory] = useState(false);

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

  // --- Discover functions ---
  async function loadDiscoverHistory() {
    try {
      const history = await sendMessage<
        Array<{ query: string; executedAt: string; resultCount: number }>
      >({
        type: "discovery:history",
      });
      setDiscoverHistory(history.slice(0, 10));
    } catch (error) {
      console.error("[SidePanel] Error loading discover history:", error);
    }
  }

  function normalizeDiscoveryResult(
    response: (DiscoverySearchResult & { error?: string }) | null | undefined,
  ): DiscoverySearchResult {
    if (!response || typeof response.error === "string") {
      throw new Error(response?.error ?? "El buscador devolvió una respuesta vacía");
    }
    if (!Array.isArray(response.jobs)) {
      throw new Error("El buscador devolvió una respuesta inválida");
    }
    return response;
  }

  async function runDiscoverSearch(isNewSearch = true, queryOverride?: string) {
    const query = (queryOverride ?? discoverQuery).trim();
    if (!query) return;

    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoverWarnings([]);
    if (isNewSearch) {
      setDiscoverPage(1);
      setDiscoverResults([]);
      setDiscoverTotal(0);
      setDiscoverHiddenUnknown(0);
      setDiscoverHiddenUnknownLocation(0);
    }

    try {
      const response = await sendMessage<DiscoverySearchResult & { error?: string }>(
        {
          type: "discovery:search",
          query,
          filters: discoverFilters,
          source: discoverSource === "all" ? undefined : discoverSource,
          page: 1,
          pageSize: DISCOVER_PAGE_SIZE,
        },
        { timeoutMs: 120_000 },
      );
      const result = normalizeDiscoveryResult(response);

      setDiscoverResults(result.jobs);
      setDiscoverTotal(result.total);
      setDiscoverPage(result.page);
      setDiscoverHiddenUnknown(result.hiddenUnknownWorkMode ?? 0);
      setDiscoverHiddenUnknownLocation(result.hiddenUnknownLocation ?? 0);
      setDiscoverWarnings(result.warnings ?? []);
      void loadDiscoverHistory();
    } catch (error) {
      setDiscoverError(error instanceof Error ? error.message : "Error al buscar ofertas");
      console.error("[SidePanel] Discover search error:", error);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function loadMoreDiscover() {
    const nextPage = discoverPage + 1;
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const response = await sendMessage<DiscoverySearchResult & { error?: string }>(
        {
          type: "discovery:list",
          query: discoverQuery.trim() || undefined,
          filters: discoverFilters,
          source: discoverSource === "all" ? undefined : discoverSource,
          page: nextPage,
          pageSize: DISCOVER_PAGE_SIZE,
        },
        { timeoutMs: 30_000 },
      );
      const result = normalizeDiscoveryResult(response);

      setDiscoverResults((prev) => {
        const seen = new Set(prev.map((job) => job.id));
        return [...prev, ...result.jobs.filter((job) => !seen.has(job.id))];
      });
      setDiscoverTotal(result.total);
      setDiscoverPage(result.page);
    } catch (error) {
      setDiscoverError(
        error instanceof Error ? error.message : "No se pudieron cargar más ofertas",
      );
      console.error("[SidePanel] Load more error:", error);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function handleDiscoverAction(jobId: string, action: DiscoveryAction) {
    try {
      const response = await sendMessage<{ ok?: boolean; error?: string }>(
        { type: "discovery:action", jobId, action },
        { timeoutMs: 30_000 },
      );
      if (response?.error) throw new Error(response.error);

      if (action === "save" || action === "dismiss") {
        setDiscoverResults((prev) => prev.filter((job) => job.id !== jobId));
        setDiscoverTotal((prev) => Math.max(0, prev - 1));
      } else {
        const reminderAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
        setDiscoverResults((prev) =>
          prev.map((job) =>
            job.id === jobId ? { ...job, userAction: "remind_later", reminderAt } : job,
          ),
        );
      }
    } catch (error) {
      console.error("[SidePanel] Discover action error:", error);
      setDiscoverError(error instanceof Error ? error.message : "No se pudo completar la acción");
    }
  }

  function useHistoryQuery(query: string) {
    setDiscoverQuery(query);
    setShowHistory(false);
    void runDiscoverSearch(true, query);
  }

  // Load history on mount
  useEffect(() => {
    loadDiscoverHistory();
  }, []);

  const pending = extensionStatus?.pending ?? 0;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <FaIcon icon={faBriefcase} size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate">Postulia</p>
            <SyncLine status={extensionStatus} pending={pending} />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {extensionStatus?.apiUrl && extensionStatus.loggedIn && (
            <button
              type="button"
              onClick={() => void syncNow()}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              title="Sincronizar ahora"
            >
              <FaIcon
                icon={faArrowsRotate}
                size={15}
                className={syncing ? "animate-spin" : undefined}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => void openDashboard("/dashboard.html?tab=settings")}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            title="Ajustes"
          >
            <FaIcon icon={faGear} size={15} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-2">
        {(["capture", "discover"] as SidePanelTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab
                ? "text-brand-600 border-brand-600"
                : "text-slate-500 hover:text-slate-700 hover:border-slate-300",
            )}
          >
            {tab === "capture" ? (
              <>
                <FaIcon icon={faCamera} size={14} /> Capturar
              </>
            ) : (
              <>
                <FaIcon icon={faCompass} size={14} /> Descubrir
              </>
            )}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-2 sm:p-3">
        {activeTab === "capture" && (
          <div>
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

              {capture.stage === "empty" && (
                <p className="text-xs text-slate-500">{capture.message}</p>
              )}

              {capture.stage === "error" && (
                <p className="text-xs text-rose-600">{capture.message}</p>
              )}

              {capture.stage === "saved" && (
                <div className="space-y-2">
                  <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                    <FaIcon icon={faCircleCheck} size={14} className="mt-0.5" />
                    Guardado: {capture.title}
                  </p>
                  <Button size="sm" className="w-full" onClick={() => void openDashboard()}>
                    <FaIcon icon={faTableColumns} size={14} /> Abrir Postulia
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
                      Ya tienes esta oferta guardada. Puedes actualizar su estado o guardarla de
                      nuevo.
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
                              "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
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
                  Ver todos <FaIcon icon={faArrowRight} size={11} />
                </button>
              </div>

              {reminders.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs text-slate-400">
                  Sin recordatorios pendientes.
                </p>
              ) : (
                <ul className="space-y-1">
                  {reminders.map((reminder) => {
                    const application = applications.find(
                      (item) => item.id === reminder.applicationId,
                    );
                    const overdue = new Date(reminder.dueAt).getTime() < Date.now();
                    return (
                      <li key={reminder.id}>
                        <button
                          type="button"
                          onClick={() =>
                            application &&
                            void openDashboard(`/dashboard.html?app=${application.id}`)
                          }
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left hover:border-brand-300"
                        >
                          <FaIcon
                            icon={faCalendarCheck}
                            size={13}
                            className={overdue ? "text-rose-500" : "text-amber-500"}
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
          </div>
        )}

        {activeTab === "discover" && (
          <div className="space-y-3">
            {/* Search bar */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <FaIcon
                      icon={faMagnifyingGlass}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                      size={16}
                    />
                    <input
                      type="text"
                      value={discoverQuery}
                      onChange={(e) => setDiscoverQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runDiscoverSearch(true)}
                      placeholder="Buscar ofertas (p. ej., backend, React, Python…)"
                      className="w-full pl-8 pr-4 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:border-brand-500"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void runDiscoverSearch(true)}
                    disabled={discoverLoading || !discoverQuery.trim()}
                  >
                    {discoverLoading ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Buscando…
                      </span>
                    ) : (
                      "Buscar"
                    )}
                  </Button>
                </div>

                {/* Filters row */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={discoverSource}
                    onChange={(e) => setDiscoverSource(e.target.value as "all" | Source)}
                    className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700"
                  >
                    <option value="all">Todos los portales</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="indeed">Indeed</option>
                    <option value="computrabajo">Computrabajo</option>
                    <option value="bumeran">Bumeran</option>
                    <option value="getonbrd">Get on Board</option>
                    <option value="torre">Torre</option>
                  </select>

                  <div className="relative">
                    <input
                      type="text"
                      value={discoverFilters.location || ""}
                      onChange={(e) =>
                        setDiscoverFilters({
                          ...discoverFilters,
                          location: e.target.value || undefined,
                        })
                      }
                      placeholder="Ubicación (p. ej., Bogotá, Medellín, Remoto)"
                      className="px-2 py-1 pr-6 rounded border border-slate-300 text-slate-700 min-w-[140px]"
                    />
                    {discoverFilters.location && (
                      <button
                        type="button"
                        aria-label="Limpiar ubicación"
                        title="Limpiar ubicación"
                        onClick={() =>
                          setDiscoverFilters({
                            ...discoverFilters,
                            location: undefined,
                            includeUnknownLocation: undefined,
                          })
                        }
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <FaIcon icon={faXmark} size={12} />
                      </button>
                    )}
                  </div>

                  {discoverFilters.location?.trim() &&
                    isLocationFilterActive(discoverFilters.location) &&
                    !resolveCountry(discoverFilters.location) && (
                      <span
                        className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
                        title="Los portales se buscan por país; sin uno reconocido se usa Colombia."
                      >
                        País no reconocido: se buscará en Colombia
                      </span>
                    )}

                  {isLocationFilterActive(discoverFilters.location) && (
                    <label
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-300 bg-white text-slate-600 cursor-pointer select-none"
                      title="Muestra también las ofertas en las que el portal no indica la ubicación."
                    >
                      <input
                        type="checkbox"
                        checked={discoverFilters.includeUnknownLocation ?? false}
                        onChange={(e) =>
                          setDiscoverFilters({
                            ...discoverFilters,
                            includeUnknownLocation: e.target.checked || undefined,
                          })
                        }
                        className="h-3 w-3 rounded border-slate-300 text-brand-600"
                      />
                      Incluir sin ubicación
                    </label>
                  )}

                  <select
                    value={discoverFilters.workMode || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDiscoverFilters({
                        ...discoverFilters,
                        workMode:
                          value === "remote" || value === "hybrid" || value === "onsite"
                            ? value
                            : undefined,
                        includeUnknownWorkMode:
                          value === "remote" || value === "hybrid" || value === "onsite"
                            ? discoverFilters.includeUnknownWorkMode
                            : undefined,
                      });
                    }}
                    className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700"
                  >
                    <option value="">Todas las modalidades</option>
                    <option value="remote">Remoto</option>
                    <option value="hybrid">Híbrido</option>
                    <option value="onsite">Presencial</option>
                  </select>

                  {discoverFilters.workMode && (
                    <label
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-300 bg-white text-slate-600 cursor-pointer select-none"
                      title="Muestra también las ofertas en las que el portal no indica la modalidad."
                    >
                      <input
                        type="checkbox"
                        checked={discoverFilters.includeUnknownWorkMode ?? false}
                        onChange={(e) =>
                          setDiscoverFilters({
                            ...discoverFilters,
                            includeUnknownWorkMode: e.target.checked || undefined,
                          })
                        }
                        className="h-3 w-3 rounded border-slate-300 text-brand-600"
                      />
                      Incluir sin modalidad
                    </label>
                  )}

                  <select
                    value={discoverFilters.postedWithinDays || ""}
                    onChange={(e) =>
                      setDiscoverFilters({
                        ...discoverFilters,
                        postedWithinDays: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700"
                  >
                    <option value="">Cualquier fecha</option>
                    <option value="1">Últimas 24 h</option>
                    <option value="3">Últimos 3 días</option>
                    <option value="7">Última semana</option>
                    <option value="30">Último mes</option>
                  </select>
                </div>
              </div>

              {/* History dropdown */}
              {showHistory && discoverHistory.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-1">Historial reciente</p>
                  <div className="flex flex-wrap gap-1">
                    {discoverHistory.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => useHistoryQuery(h.query)}
                        className="px-2 py-1 rounded-full bg-slate-100 text-xs text-slate-600 hover:bg-slate-200"
                      >
                        {h.query} ({h.resultCount})
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowHistory(false)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-slate-400 hover:text-slate-600"
                    >
                      <FaIcon icon={faXmark} size={10} /> Cerrar
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="w-full mt-2 px-2 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-50"
              >
                {showHistory ? "Ocultar historial" : `Historial (${discoverHistory.length})`}
              </button>
            </div>

            {/* Results */}
            {discoverError && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
                {discoverError}
              </div>
            )}

            {discoverWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <p className="flex items-start gap-1.5 font-medium">
                  <FaIcon icon={faTriangleExclamation} size={12} className="mt-0.5" />
                  Avisos de la búsqueda:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {discoverWarnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {discoverHiddenUnknown > 0 && discoverFilters.workMode && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                Se ocultaron {discoverHiddenUnknown} oferta
                {discoverHiddenUnknown === 1 ? "" : "s"} porque el portal no confirmó la modalidad.
                Marca «Incluir sin modalidad» para verlas.
              </div>
            )}

            {discoverHiddenUnknownLocation > 0 &&
              isLocationFilterActive(discoverFilters.location) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
                  Se ocultaron {discoverHiddenUnknownLocation} oferta
                  {discoverHiddenUnknownLocation === 1 ? "" : "s"} porque el portal no indicó la
                  ubicación. Marca «Incluir sin ubicación» para verlas.
                </div>
              )}

            {discoverResults.length === 0 && !discoverLoading && !discoverError && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-400">
                {discoverWarnings.length > 0
                  ? "No se encontraron ofertas. Revisa el aviso de arriba para ver qué ocurrió con el portal."
                  : discoverQuery
                    ? "No se encontraron ofertas. Prueba cambiando los filtros o ampliando la búsqueda."
                    : "Escribe una búsqueda y pulsa «Buscar» para encontrar ofertas en LinkedIn, Indeed, Computrabajo y más."}
              </div>
            )}

            {discoverResults.length > 0 && (
              <div className="space-y-2">
                {discoverResults.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {job.jobTitle}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{job.company}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {job.location && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                              {job.location}
                            </span>
                          )}
                          {job.workMode ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-brand-50 text-brand-700"
                              title={workModeHint(job.workModeSource, job.workModeConfidence)}
                            >
                              <FaIcon icon={WORK_MODE_ICONS[job.workMode]} size={10} />
                              {WORK_MODE_LABELS[job.workMode]}
                            </span>
                          ) : (
                            discoverFilters.workMode && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500"
                                title="La oferta no indica la modalidad; la incluiste manualmente en la búsqueda."
                              >
                                <FaIcon icon={faCircleInfo} size={10} />
                                Modalidad sin especificar
                              </span>
                            )
                          )}
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700">
                            {SOURCE_LABELS[job.source]}
                          </span>
                          {job.postedAt && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500">
                              {formatDateEs(job.postedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-medium bg-slate-100 text-slate-500"
                        title="Confianza de los datos extraídos de la oferta"
                      >
                        {CONFIDENCE_LABELS[job.confidence]}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void browser.tabs.create({ url: job.url })}
                        className="flex-1 min-w-[100px] px-2 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 rounded-lg border border-brand-200"
                      >
                        Abrir oferta
                      </button>
                      {!job.userAction && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDiscoverAction(job.id, "save")}
                            className="flex-1 min-w-[100px] px-2 py-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg"
                          >
                            Guardar en Postulia
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDiscoverAction(job.id, "remind_later")}
                            className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                          >
                            <FaIcon icon={faBell} size={11} /> Recordar luego
                          </button>
                        </>
                      )}
                      {job.userAction === "saved" && (
                        <span className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg text-center">
                          <FaIcon icon={faCircleCheck} size={11} /> Guardado
                        </span>
                      )}
                      {job.userAction === "dismissed" && (
                        <span className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-400 bg-slate-50 rounded-lg text-center">
                          <FaIcon icon={faBan} size={11} /> Descartada
                        </span>
                      )}
                      {job.userAction === "remind_later" && (
                        <span className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg text-center">
                          <FaIcon icon={faBell} size={11} /> Recordar:{" "}
                          {job.reminderAt ? formatDateEs(job.reminderAt) : "pendiente"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {discoverLoading && discoverResults.length > 0 && (
                  <div className="flex justify-center py-4">
                    <Spinner label="Cargando más…" />
                  </div>
                )}

                {discoverResults.length > 0 &&
                  !discoverLoading &&
                  discoverResults.length < discoverTotal && (
                    <button
                      type="button"
                      onClick={() => void loadMoreDiscover()}
                      className="w-full px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 rounded-lg border border-brand-200"
                    >
                      Cargar más ({discoverResults.length} de {discoverTotal})
                    </button>
                  )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-2 sm:px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => void openDashboard()}
        >
          <FaIcon icon={faTableColumns} size={14} /> Abrir panel completo
        </Button>
      </footer>
    </div>
  );
}

function SyncLine({ status, pending }: { status: ExtensionStatus | null; pending: number }) {
  if (!status) return <p className="text-[10px] text-slate-400">Cargando…</p>;
  // Sin servidor no hay sesión ni cola: solo datos locales.
  if (!status.apiUrl) {
    return <p className="text-[10px] text-slate-400">Guardado en este navegador</p>;
  }
  if (!status.loggedIn) {
    return <p className="text-[10px] text-slate-400">Sin sesión</p>;
  }
  return (
    <p className="flex items-center gap-1 text-[10px] text-slate-400">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status.lastSyncError ? "bg-rose-500" : "bg-emerald-500",
        )}
      />
      {status.email ?? "Conectado"} · {pending} {pending === 1 ? "pendiente" : "pendientes"}
    </p>
  );
}
