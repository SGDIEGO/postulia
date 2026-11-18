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
  faEnvelope,
  faGear,
  faHouse,
  faMagnifyingGlass,
  faPaperPlane,
  faRobot,
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
import { Button, IconButton, Skeleton, Spinner, cn } from "~/components/ui";
import { useToast } from "~/components/Toast";
import { useApplications, useExtensionStatus, useReminders } from "~/lib/hooks";
import { getSettings } from "~/lib/settings";
import { isLocationFilterActive, resolveCountry } from "~/lib/discovery/location";
import { isExtractPageResult } from "~/lib/extractors";
import type { ExtractPageResult, ExtractedJobResult } from "~/lib/extractors";
import {
  sendMessage,
  type CaptureResponse,
  type DuplicateResponse,
  type ExtensionStatus,
} from "~/lib/messaging";
import { generateEmailDraft, sendReviewedEmail, type EmailDraft } from "~/lib/ia.service";
import { parsePastedPost } from "~/lib/linkedin-post";

type CaptureState =
  | { stage: "loading" }
  | { stage: "empty"; message: string; url?: string }
  | { stage: "ready"; job: ExtractedJobResult; duplicate: boolean }
  | { stage: "saved"; title: string }
  | { stage: "error"; message: string };

/**
 * Normaliza la respuesta del content script. Las pestañas abiertas antes de
 * actualizar la extensión pueden responder con el formato antiguo (la oferta
 * directamente); se acepta para no romper la captura hasta recargarlas.
 */
function toExtractPageResult(value: unknown, pageUrl: string): ExtractPageResult {
  if (isExtractPageResult(value)) return value;

  const job = (value ?? null) as ExtractedJobResult | null;
  return {
    job,
    classification: {
      kind: job ? "job" : "unknown",
      site: "other",
      reason: job ? "" : "No se detectó una oferta en esta página.",
      hasJobPosting: false,
    },
    pageUrl,
  };
}

/**
 * Pide la extracción al content script. Si la página no está entre los
 * portales compatibles, lo inyecta con activeTab (el clic en la acción de la
 * extensión concede permiso temporal para la pestaña activa).
 */
async function extractFromTab(
  tabId: number,
  pageUrl: string,
): Promise<ExtractPageResult | undefined> {
  try {
    return toExtractPageResult(
      await browser.tabs.sendMessage(tabId, {
        type: "postulia:extract",
      }),
      pageUrl,
    );
  } catch {
    // Sin content script: se inyecta en la pestaña actual.
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return toExtractPageResult(
      await browser.tabs.sendMessage(tabId, {
        type: "postulia:extract",
      }),
      pageUrl,
    );
  } catch {
    return undefined;
  }
}

type SidePanelTab = "capture" | "discover" | "post";

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

const TABS: { id: SidePanelTab; label: string; icon: typeof faCamera }[] = [
  { id: "capture", label: "Guardar oferta", icon: faCamera },
  { id: "post", label: "Generar correo", icon: faRobot },
  { id: "discover", label: "Buscar ofertas", icon: faCompass },
];

const POST_STEPS = ["Pegar el post", "Revisar el correo", "Enviado"] as const;

export function SidePanelApp() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SidePanelTab>("capture");
  const [capture, setCapture] = useState<CaptureState>({ stage: "loading" });
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [notes, setNotes] = useState("");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // Post IA: el usuario pega el texto del post de LinkedIn.
  const [postText, setPostText] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [postEmail, setPostEmail] = useState("");
  const [postBusy, setPostBusy] = useState(false);
  const [postEmailTouched, setPostEmailTouched] = useState(false);
  const [postDraft, setPostDraft] = useState<EmailDraft | null>(null);
  const [postStage, setPostStage] = useState<"edit" | "review" | "sending" | "sent">("edit");
  const [postResult, setPostResult] = useState<{ ok: boolean; message: string } | null>(null);

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

      const extracted = await extractFromTab(tab.id, tab.url);

      if (extracted === undefined) {
        setCapture({
          stage: "empty",
          message: "No se pudo acceder a esta página. Recarga la pestaña y vuelve a intentar.",
          url: tab.url,
        });
        return;
      }

      if (extracted.job === null) {
        const { classification } = extracted;
        const message =
          classification.kind === "listing"
            ? "Estás en un listado de ofertas. Abre una oferta (clic en su título) y vuelve a detectar."
            : classification.site !== "other"
              ? `Esta página de ${SOURCE_LABELS[classification.site]} no es la ficha de una oferta. Abre una oferta concreta y vuelve a intentar.`
              : "Esta página no parece una oferta. Si el portal no es compatible, abre la vacante y vuelve a pulsar el icono de Postulia.";

        setCapture({
          stage: "empty",
          message,
          url: extracted.pageUrl || tab.url,
        });
        return;
      }

      const duplicate = await sendMessage<DuplicateResponse>({
        type: "postulia:duplicate-check",
        url: extracted.job.url,
      }).catch(() => ({ duplicate: false }) as DuplicateResponse);

      setCapture({ stage: "ready", job: extracted.job, duplicate: duplicate.duplicate });
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

  // Vuelve a detectar cuando el usuario cambia de pestaña o navega dentro de
  // la pestaña activa, sin esperar a que el panel recupere el foco.
  useEffect(() => {
    const onActivated = () => void detect();

    const onUpdated = (tabId: number, info: { status?: string; url?: string }) => {
      if (activeTabId === null || tabId !== activeTabId) return;
      if (info.status === "complete" || info.url) void detect();
    };

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [detect, activeTabId]);

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
      toast({
        title: "Postulación guardada",
        description: `${job.jobTitle} · ${job.company}`,
        tone: "success",
      });
      return;
    }

    if ("duplicate" in response && response.duplicate) {
      setCapture({ stage: "ready", job, duplicate: true });
      toast({
        title: "Ya la tenías guardada",
        description: "Actualiza el estado y vuelve a guardar si ha cambiado.",
        tone: "warning",
      });
      return;
    }

    const message = "error" in response ? response.error : "No se pudo guardar la postulación";
    setCapture({ stage: "error", message });
    toast({ title: "No se pudo guardar", description: message, tone: "error" });
  }

  function handlePostTextChange(value: string) {
    setPostText(value);
    setPostResult(null);
    setPostDraft(null);
    setPostStage("edit");

    if (!value.trim()) setPostEmailTouched(false);

    const detected = parsePastedPost(value);
    if (detected.email && !postEmailTouched) {
      setPostEmail(detected.email);
    }
    if (detected.url && !postUrl.trim()) {
      setPostUrl(detected.url);
    }
  }

  function resetPostForm() {
    setPostText("");
    setPostUrl("");
    setPostEmail("");
    setPostEmailTouched(false);
    setPostDraft(null);
    setPostStage("edit");
    setPostResult(null);
  }

  function buildPost() {
    const parsed = parsePastedPost(postText);
    return {
      author: null,
      text: parsed.text,
      url: postUrl.trim() || parsed.url,
      postedAt: null,
    };
  }

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  /** Paso 1: pide el borrador. Nunca envía el correo. */
  async function generatePostDraft(toOverride?: string) {
    const parsed = parsePastedPost(postText);
    if (!parsed.text) {
      setPostResult({ ok: false, message: "Pega el texto del post antes de continuar." });
      return;
    }

    const email = (toOverride ?? postEmail).trim();
    if (email && !isValidEmail(email)) {
      setPostResult({ ok: false, message: "El correo del reclutador no es válido." });
      return;
    }

    setPostBusy(true);
    setPostResult(null);
    try {
      const settings = await getSettings();
      if (!settings.accessToken) {
        setPostResult({ ok: false, message: "Inicia sesión para generar el correo." });
        return;
      }

      const response = await generateEmailDraft(buildPost(), email || null);

      if (!response.ok || !response.draft) {
        setPostResult({
          ok: false,
          message: response.error || "No se pudo generar el borrador.",
        });
        return;
      }

      setPostDraft({
        to: response.draft.to ?? email,
        subject: response.draft.subject,
        body: response.draft.body,
      });
      setPostStage("review");
    } catch (error) {
      setPostResult({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo generar el borrador.",
      });
      setPostStage("edit");
    } finally {
      setPostBusy(false);
    }
  }

  /** Paso 2: envía exactamente lo que el usuario revisó. */
  async function sendReviewedPost() {
    if (!postDraft) return;

    const to = postDraft.to?.trim() ?? "";
    if (!isValidEmail(to)) {
      setPostResult({ ok: false, message: "Escribe un correo destinatario válido." });
      return;
    }
    if (!postDraft.subject.trim()) {
      setPostResult({ ok: false, message: "El asunto no puede estar vacío." });
      return;
    }
    if (!postDraft.body.trim()) {
      setPostResult({ ok: false, message: "El cuerpo del correo no puede estar vacío." });
      return;
    }

    const subject = postDraft.subject.trim();
    setPostStage("sending");
    setPostResult(null);
    try {
      const settings = await getSettings();
      if (!settings.accessToken) {
        setPostStage("review");
        setPostResult({ ok: false, message: "Inicia sesión para enviar el correo." });
        return;
      }

      const response = await sendReviewedEmail({
        to,
        subject: postDraft.subject.trim(),
        body: postDraft.body.trim(),
      });

      if (!response.ok) {
        setPostStage("review");
        setPostResult({
          ok: false,
          message: response.error || "No se pudo enviar el correo.",
        });
        toast({
          title: "No se pudo enviar el correo",
          description: response.error,
          tone: "error",
        });
        return;
      }

      await sendMessage({
        type: "postulia:save-linkedin-post",
        post: buildPost(),
      }).catch(() => undefined);

      setPostStage("sent");
      setPostResult({ ok: true, message: response.message || `Correo enviado a ${to}.` });
      toast({
        title: "Correo enviado",
        description: `${subject} · ${to}`,
        tone: "success",
      });
    } catch (error) {
      setPostStage("review");
      setPostResult({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo enviar el correo.",
      });
    }
  }

  function backToEdit() {
    setPostDraft(null);
    setPostStage("edit");
    setPostResult(null);
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
    <div className="flex h-screen flex-col bg-surface-muted text-ink">
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <FaIcon icon={faBriefcase} size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-title font-bold text-ink">Postulia</p>
            <SyncLine status={extensionStatus} pending={pending} />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {extensionStatus?.apiUrl && extensionStatus.loggedIn && (
            <IconButton
              label="Sincronizar ahora"
              icon={faArrowsRotate}
              size={15}
              onClick={() => void syncNow()}
              disabled={syncing}
            />
          )}
          <IconButton
            label="Abrir ajustes"
            icon={faGear}
            size={15}
            onClick={() => void openDashboard("/dashboard.html?tab=settings")}
          />
        </div>
      </header>

      {/* Pestañas */}
      <div role="tablist" aria-label="Secciones del panel" className="flex border-b border-line bg-surface px-1">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "-mb-px flex min-h-10 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-label font-semibold transition-colors",
                active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              <FaIcon icon={tab.icon} size={13} />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <main className="flex-1 overflow-y-auto p-2 sm:p-3">
        {activeTab === "capture" && (
          <div
            role="tabpanel"
            id="panel-capture"
            aria-labelledby="tab-capture"
            className="space-y-3"
          >
            <section className="rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-label font-semibold uppercase tracking-wide text-ink-muted">
                  Oferta de esta pestaña
                </h2>
                <button
                  type="button"
                  onClick={() => void detect()}
                  className="min-h-8 text-label font-medium text-brand-600 hover:underline"
                >
                  Volver a detectar
                </button>
              </div>

              {capture.stage === "loading" && (
                <div className="space-y-2" aria-busy="true" aria-label="Leyendo la pestaña">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                </div>
              )}

              {capture.stage === "empty" && (
                <div className="space-y-2">
                  <p className="text-label text-ink-muted">{capture.message}</p>
                  {capture.url && (
                    <p className="break-all text-label leading-snug text-ink-subtle">
                      {capture.url}
                    </p>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => void detect()}>
                    Reintentar
                  </Button>
                </div>
              )}

              {capture.stage === "error" && (
                <div className="space-y-2">
                  <p className="text-label text-danger">{capture.message}</p>
                  <Button size="sm" variant="secondary" onClick={() => void detect()}>
                    Reintentar
                  </Button>
                </div>
              )}

              {capture.stage === "saved" && (
                <div className="space-y-2">
                  <p className="flex items-start gap-1.5 rounded-control bg-success-soft px-2 py-1.5 text-label text-emerald-800">
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
                    <p className="text-title font-semibold leading-tight text-ink">
                      {capture.job.jobTitle ?? "Oferta sin título"}
                    </p>
                    <p className="text-label text-ink-muted">
                      {capture.job.company ?? "Empresa sin especificar"}
                      {capture.job.location ? ` · ${capture.job.location}` : ""}
                    </p>
                  </div>

                  {capture.duplicate && (
                    <p className="rounded-control bg-warning-soft px-2 py-1.5 text-label text-amber-800">
                      Ya tienes esta oferta guardada. Puedes actualizar su estado o guardarla de
                      nuevo.
                    </p>
                  )}

                  <div>
                    <p className="mb-1 text-label font-medium text-ink-muted">Estado</p>
                    <div className="flex flex-wrap gap-1">
                      {(["saved", "applied", "screening", "interview"] as ApplicationStatus[]).map(
                        (option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setStatus(option)}
                            className={cn(
                              "min-h-8 whitespace-nowrap rounded-full px-2.5 py-1 text-label font-medium transition",
                              status === option
                                ? "bg-brand-600 text-white"
                                : "bg-surface-sunken text-ink-soft hover:bg-line",
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
                    aria-label="Nota rápida"
                    className="w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
                  />

                  <Button size="sm" className="w-full" onClick={() => void save(capture.duplicate)}>
                    {capture.duplicate ? "Actualizar estado y guardar" : "Guardar postulación"}
                  </Button>
                </div>
              )}
            </section>

            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h2 className="text-label font-semibold uppercase tracking-wide text-ink-muted">
                  Recientes
                </h2>
                <button
                  type="button"
                  onClick={() => void openDashboard()}
                  className="text-label font-medium text-brand-600 hover:underline"
                >
                  Ver todas
                </button>
              </div>

              {applications.length === 0 ? (
                <p className="rounded-control border border-dashed border-line-strong bg-surface px-3 py-4 text-center text-label text-ink-subtle">
                  Sin postulaciones todavía.
                </p>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {applications.slice(0, 6).map((application) => (
                    <li key={application.id}>
                      <button
                        type="button"
                        onClick={() => void openDashboard(`/dashboard.html?app=${application.id}`)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-surface-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label font-medium text-ink">
                            {application.jobTitle}
                          </span>
                          <span className="block truncate text-label text-ink-muted">
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
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h2 className="text-label font-semibold uppercase tracking-wide text-ink-muted">
                  Seguimientos
                </h2>
                <button
                  type="button"
                  onClick={() => void openDashboard("/dashboard.html?tab=reminders")}
                  className="inline-flex items-center gap-0.5 text-label font-medium text-brand-600 hover:underline"
                >
                  Ver todos <FaIcon icon={faArrowRight} size={11} />
                </button>
              </div>

              {reminders.length === 0 ? (
                <p className="rounded-control border border-dashed border-line-strong bg-surface px-3 py-3 text-center text-label text-ink-subtle">
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
                          className="flex min-h-9 w-full items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-left transition hover:border-brand-300"
                        >
                          <FaIcon
                            icon={faCalendarCheck}
                            size={13}
                            className={overdue ? "text-rose-500" : "text-amber-500"}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label font-medium text-ink-soft">
                              {application?.company ?? "Postulación"}
                            </span>
                            <span
                              className={cn(
                                "block text-label",
                                overdue ? "text-danger" : "text-ink-subtle",
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

        {activeTab === "post" && (
          <div
            role="tabpanel"
            id="panel-post"
            aria-labelledby="tab-post"
            className="space-y-3"
          >
            <section className="rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-label font-semibold uppercase tracking-wide text-ink-muted">
                  Correo para una oferta publicada en LinkedIn
                </h2>
                {(postText || postEmail || postUrl || postDraft || postResult) && (
                  <button
                    type="button"
                    onClick={resetPostForm}
                    disabled={postBusy || postStage === "sending"}
                    className="min-h-8 text-label font-medium text-brand-600 hover:underline disabled:opacity-50"
                  >
                    Limpiar
                  </button>
                )}
              </div>

              {/* Indicador de pasos: el usuario siempre sabe dónde está. */}
              <ol className="mb-3 flex items-center gap-1 text-label" aria-label="Pasos del correo">
                {POST_STEPS.map((step, index) => {
                  const current =
                    (postStage === "edit" && index === 0) ||
                    ((postStage === "review" || postStage === "sending") && index === 1) ||
                    (postStage === "sent" && index === 2);
                  const done =
                    (postStage === "review" || postStage === "sending") && index === 0
                      ? true
                      : postStage === "sent" && index < 2;
                  return (
                    <li key={step} className="flex min-w-0 items-center gap-1">
                      {index > 0 && <span className="text-ink-subtle" aria-hidden="true">›</span>}
                      <span
                        aria-current={current ? "step" : undefined}
                        className={cn(
                          "flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5",
                          current && "bg-brand-50 font-semibold text-brand-700",
                          done && "text-success",
                          !current && !done && "text-ink-subtle",
                        )}
                      >
                        {done ? (
                          <FaIcon icon={faCircleCheck} size={11} />
                        ) : (
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-label font-semibold",
                              current ? "bg-brand-600 text-white" : "bg-surface-sunken text-ink-muted",
                            )}
                          >
                            {index + 1}
                          </span>
                        )}
                        <span className="truncate">{step}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              {postStage === "edit" && (
                <>
                  <textarea
                    value={postText}
                    onChange={(event) => handlePostTextChange(event.target.value)}
                    rows={9}
                    aria-label="Texto del post de LinkedIn"
                    placeholder={
                      "Pega aquí el texto del post…\n\nEj: Buscamos desarrollador junior. Envía tu CV a rrhh@empresa.com"
                    }
                    className="w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
                  />

                  <label className="mt-3 block text-label font-medium text-ink-soft">
                    Correo del reclutador
                    <input
                      type="email"
                      value={postEmail}
                      onChange={(event) => {
                        setPostEmail(event.target.value);
                        setPostEmailTouched(true);
                        setPostResult(null);
                      }}
                      placeholder="Se detecta del texto; escríbelo si no aparece"
                      className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
                    />
                  </label>

                  <label className="mt-2 block text-label font-medium text-ink-soft">
                    URL del post (opcional)
                    <input
                      type="url"
                      value={postUrl}
                      onChange={(event) => {
                        setPostUrl(event.target.value);
                        setPostResult(null);
                      }}
                      placeholder="https://www.linkedin.com/posts/…"
                      className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
                    />
                  </label>

                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    loading={postBusy}
                    onClick={() => void generatePostDraft()}
                    disabled={postBusy || !postText.trim()}
                  >
                    {!postBusy && <FaIcon icon={faRobot} size={14} />}
                    {postBusy ? "Generando borrador…" : "Generar borrador con IA"}
                  </Button>

                  {postResult && (
                    <p
                      role="alert"
                      className={cn(
                        "mt-2 rounded-control px-2 py-1.5 text-label",
                        postResult.ok
                          ? "bg-success-soft text-emerald-800"
                          : "bg-danger-soft text-danger",
                      )}
                    >
                      {postResult.message}
                    </p>
                  )}
                </>
              )}

              {postStage !== "edit" && postDraft && (
                <>
                  {postStage === "sent" ? (
                    <div className="space-y-2">
                      <p className="flex items-start gap-1.5 rounded-control bg-success-soft px-2 py-1.5 text-label text-emerald-800">
                        <FaIcon icon={faCircleCheck} size={14} className="mt-0.5" />
                        {postResult?.message ?? "Correo enviado."}
                      </p>
                      <Button size="sm" className="w-full" onClick={resetPostForm}>
                        <FaIcon icon={faRobot} size={14} /> Redactar otro correo
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-title font-semibold leading-tight text-ink">
                        Revisa el correo antes de enviarlo
                      </p>
                      <p className="text-label text-ink-muted">
                        No se envía nada hasta que pulses «Enviar correo». Va con tu CV adjunto.
                      </p>

                      <label className="block text-label font-medium text-ink-soft">
                        Destinatario
                        <input
                          type="email"
                          value={postDraft.to ?? ""}
                          onChange={(event) => setPostDraft({ ...postDraft, to: event.target.value })}
                          disabled={postStage === "sending"}
                          placeholder="reclutador@empresa.com"
                          className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500 disabled:bg-surface-muted"
                        />
                      </label>

                      <label className="block text-label font-medium text-ink-soft">
                        Asunto
                        <input
                          type="text"
                          value={postDraft.subject}
                          onChange={(event) =>
                            setPostDraft({ ...postDraft, subject: event.target.value })
                          }
                          disabled={postStage === "sending"}
                          className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label text-ink outline-none focus:border-brand-500 disabled:bg-surface-muted"
                        />
                      </label>

                      <label className="block text-label font-medium text-ink-soft">
                        Mensaje
                        <textarea
                          value={postDraft.body}
                          onChange={(event) => setPostDraft({ ...postDraft, body: event.target.value })}
                          disabled={postStage === "sending"}
                          rows={12}
                          className="mt-1 w-full rounded-control border border-line-strong bg-surface px-2 py-1.5 text-label leading-relaxed text-ink outline-none focus:border-brand-500 disabled:bg-surface-muted"
                        />
                      </label>

                      {postResult && !postResult.ok && (
                        <p role="alert" className="rounded-control bg-danger-soft px-2 py-1.5 text-label text-danger">
                          {postResult.message}
                        </p>
                      )}

                      <Button
                        size="sm"
                        className="w-full"
                        loading={postStage === "sending"}
                        onClick={() => void sendReviewedPost()}
                        disabled={
                          postBusy ||
                          postStage === "sending" ||
                          !postDraft.to?.trim() ||
                          !postDraft.subject.trim() ||
                          !postDraft.body.trim()
                        }
                      >
                        {postStage !== "sending" && <FaIcon icon={faPaperPlane} size={14} />}
                        {postStage === "sending" ? "Enviando correo…" : "Enviar correo"}
                      </Button>

                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={backToEdit}
                          disabled={postBusy || postStage === "sending"}
                          className="min-h-8 text-label font-medium text-ink-muted hover:underline disabled:opacity-50"
                        >
                          Volver
                        </button>
                        <button
                          type="button"
                          onClick={() => void generatePostDraft(postDraft.to ?? postEmail)}
                          disabled={postBusy || postStage === "sending"}
                          className="min-h-8 text-label font-medium text-brand-600 hover:underline disabled:opacity-50"
                        >
                          {postBusy ? "Regenerando…" : "Regenerar borrador"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        {activeTab === "discover" && (
          <div role="tabpanel" id="panel-discover" aria-labelledby="tab-discover" className="space-y-3">
            {/* Barra de búsqueda */}
            <div className="rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <FaIcon
                      icon={faMagnifyingGlass}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle"
                      size={16}
                    />
                    <input
                      type="text"
                      value={discoverQuery}
                      onChange={(e) => setDiscoverQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runDiscoverSearch(true)}
                      placeholder="Buscar ofertas (p. ej., backend, React, Python…)"
                      aria-label="Buscar ofertas"
                      className="w-full rounded-control border border-line-strong bg-surface py-2 pl-8 pr-4 text-title text-ink outline-none placeholder:text-ink-subtle focus:border-brand-500"
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
                    className="min-h-8 rounded-control border border-line-strong bg-surface px-2 py-1 text-label text-ink-soft"
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
                      className="min-h-8 min-w-[140px] rounded-control border border-line-strong bg-surface px-2 py-1 pr-6 text-label text-ink-soft placeholder:text-ink-subtle"
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
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 leading-none text-ink-subtle transition hover:bg-surface-sunken hover:text-ink-soft"
                      >
                        <FaIcon icon={faXmark} size={12} />
                      </button>
                    )}
                  </div>

                  {discoverFilters.location?.trim() &&
                    isLocationFilterActive(discoverFilters.location) &&
                    !resolveCountry(discoverFilters.location) && (
                      <span
                        className="rounded bg-amber-50 px-2 py-1 text-label text-amber-800"
                        title="Los portales se buscan por país; sin uno reconocido se usa Colombia."
                      >
                        País no reconocido: se buscará en Colombia
                      </span>
                    )}

                  {isLocationFilterActive(discoverFilters.location) && (
                    <label
                      className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2 py-1 text-label text-ink-soft"
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
                        className="h-3 w-3 rounded border-line-strong text-brand-600"
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
                    className="min-h-8 rounded-control border border-line-strong bg-surface px-2 py-1 text-label text-ink-soft"
                  >
                    <option value="">Todas las modalidades</option>
                    <option value="remote">Remoto</option>
                    <option value="hybrid">Híbrido</option>
                    <option value="onsite">Presencial</option>
                  </select>

                  {discoverFilters.workMode && (
                    <label
                      className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2 py-1 text-label text-ink-soft"
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
                        className="h-3 w-3 rounded border-line-strong text-brand-600"
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
                    className="min-h-8 rounded-control border border-line-strong bg-surface px-2 py-1 text-label text-ink-soft"
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
                <div className="mt-2 border-t border-line pt-2">
                  <p className="mb-1 text-label font-medium text-ink-muted">Historial reciente</p>
                  <div className="flex flex-wrap gap-1">
                    {discoverHistory.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => useHistoryQuery(h.query)}
                        className="min-h-8 rounded-full bg-surface-sunken px-2 py-1 text-label text-ink-soft transition hover:bg-line"
                      >
                        {h.query} ({h.resultCount})
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowHistory(false)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 py-1 text-label text-ink-subtle transition hover:text-ink-soft"
                    >
                      <FaIcon icon={faXmark} size={10} /> Cerrar
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="mt-2 min-h-8 w-full rounded-control px-2 py-1 text-label text-ink-muted transition hover:bg-surface-muted"
              >
                {showHistory ? "Ocultar historial" : `Historial (${discoverHistory.length})`}
              </button>
            </div>

            {/* Results */}
            {discoverError && (
              <div
                role="alert"
                className="space-y-2 rounded-card border border-rose-200 bg-danger-soft p-3 text-label text-danger"
              >
                <p className="flex items-start gap-1.5">
                  <FaIcon icon={faTriangleExclamation} size={13} className="mt-0.5" />
                  {discoverError}
                </p>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void runDiscoverSearch(discoverResults.length === 0)}
                  disabled={discoverLoading || !discoverQuery.trim()}
                >
                  Reintentar
                </Button>
              </div>
            )}

            {discoverLoading && discoverResults.length === 0 && (
              <div className="space-y-2" aria-busy="true" aria-label="Buscando ofertas">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="space-y-2 rounded-card border border-line bg-surface p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
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
              <div className="rounded-control border border-line bg-surface-muted p-2.5 text-label text-ink-soft">
                Se ocultaron {discoverHiddenUnknown} oferta
                {discoverHiddenUnknown === 1 ? "" : "s"} porque el portal no confirmó la modalidad.
                Marca «Incluir sin modalidad» para verlas.
              </div>
            )}

            {discoverHiddenUnknownLocation > 0 &&
              isLocationFilterActive(discoverFilters.location) && (
                <div className="rounded-control border border-line bg-surface-muted p-2.5 text-label text-ink-soft">
                  Se ocultaron {discoverHiddenUnknownLocation} oferta
                  {discoverHiddenUnknownLocation === 1 ? "" : "s"} porque el portal no indicó la
                  ubicación. Marca «Incluir sin ubicación» para verlas.
                </div>
              )}

            {discoverResults.length === 0 && !discoverLoading && !discoverError && (
              <div className="rounded-card border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-label text-ink-subtle">
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
                    className="rounded-card border border-line bg-surface p-3 shadow-card transition hover:border-brand-300 hover:shadow-pop"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-title font-semibold text-ink">
                          {job.jobTitle}
                        </p>
                        <p className="truncate text-label text-ink-muted">{job.company}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {job.location && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-surface-sunken px-1.5 py-0.5 text-label text-ink-soft">
                              {job.location}
                            </span>
                          )}
                          {job.workMode ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-label text-brand-700"
                              title={workModeHint(job.workModeSource, job.workModeConfidence)}
                            >
                              <FaIcon icon={WORK_MODE_ICONS[job.workMode]} size={10} />
                              {WORK_MODE_LABELS[job.workMode]}
                            </span>
                          ) : (
                            discoverFilters.workMode && (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 text-label text-ink-muted"
                                title="La oferta no indica la modalidad; la incluiste manualmente en la búsqueda."
                              >
                                <FaIcon icon={faCircleInfo} size={10} />
                                Modalidad sin especificar
                              </span>
                            )
                          )}
                          <span className="inline-flex items-center gap-0.5 rounded bg-success-soft px-1.5 py-0.5 text-label text-emerald-700">
                            {SOURCE_LABELS[job.source]}
                          </span>
                          {job.postedAt && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-surface-sunken px-1.5 py-0.5 text-label text-ink-muted">
                              {formatDateEs(job.postedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-surface-sunken px-2 py-1 text-label font-medium text-ink-muted"
                        title="Confianza de los datos extraídos de la oferta"
                      >
                        {CONFIDENCE_LABELS[job.confidence]}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void browser.tabs.create({ url: job.url })}
                        className="min-h-8 min-w-[100px] flex-1 rounded-control border border-brand-200 px-2 py-1.5 text-label font-medium text-brand-600 transition hover:bg-brand-50"
                      >
                        Abrir oferta
                      </button>
                      {!job.userAction && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDiscoverAction(job.id, "save")}
                            className="min-h-8 min-w-[100px] flex-1 rounded-control bg-brand-600 px-2 py-1.5 text-label font-medium text-white transition hover:bg-brand-700"
                          >
                            Guardar en Postulia
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDiscoverAction(job.id, "remind_later")}
                            className="min-h-8 min-w-[100px] flex-1 inline-flex items-center justify-center gap-1 rounded-control bg-surface-sunken px-2 py-1.5 text-label font-medium text-ink-soft transition hover:bg-line"
                          >
                            <FaIcon icon={faBell} size={11} /> Recordar luego
                          </button>
                        </>
                      )}
                      {job.userAction === "saved" && (
                        <span className="min-h-8 min-w-[100px] flex-1 inline-flex items-center justify-center gap-1 rounded-control bg-success-soft px-2 py-1.5 text-center text-label font-medium text-emerald-700">
                          <FaIcon icon={faCircleCheck} size={11} /> Guardado
                        </span>
                      )}
                      {job.userAction === "dismissed" && (
                        <span className="min-h-8 min-w-[100px] flex-1 inline-flex items-center justify-center gap-1 rounded-control bg-surface-muted px-2 py-1.5 text-center text-label font-medium text-ink-subtle">
                          <FaIcon icon={faBan} size={11} /> Descartada
                        </span>
                      )}
                      {job.userAction === "remind_later" && (
                        <span className="min-h-8 min-w-[100px] flex-1 inline-flex items-center justify-center gap-1 rounded-control bg-warning-soft px-2 py-1.5 text-center text-label font-medium text-amber-700">
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
                      className="min-h-9 w-full rounded-control border border-brand-200 px-3 py-2 text-title font-medium text-brand-600 transition hover:bg-brand-50"
                    >
                      Cargar más ({discoverResults.length} de {discoverTotal})
                    </button>
                  )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-line bg-surface px-2 py-2 sm:px-3">
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
  if (!status) return <p className="text-label text-ink-subtle">Cargando…</p>;
  // Sin servidor no hay sesión ni cola: solo datos locales.
  if (!status.apiUrl) {
    return <p className="text-label text-ink-subtle">Guardado en este navegador</p>;
  }
  if (!status.loggedIn) {
    return <p className="text-label text-ink-subtle">Sin sesión</p>;
  }
  return (
    <p className="flex items-center gap-1 text-label text-ink-subtle">
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
