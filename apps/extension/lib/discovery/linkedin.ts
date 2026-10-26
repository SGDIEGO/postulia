import { browser } from "wxt/browser";
import type { SearchFilters } from "@postulia/shared";
import type { ScraperResult } from "./scrapers.js";
import {
  buildLinkedInGuestSearchUrl,
  buildLinkedInSearchUrl,
  hasLinkedInWorkModeFilter,
  parseLinkedInJobsHtml,
  withoutCurrentJobId,
  LINKEDIN_GUEST_PAGE_SIZE,
} from "./linkedin-parser.js";
import {
  inspectLinkedInPage,
  normalizeInspectionJobs,
  nudgeLinkedInList,
  type LinkedInPageInspection,
} from "./linkedin-tab.js";

const TAB_LOAD_TIMEOUT_MS = 30_000;
const CARDS_WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 500;
const SCROLL_NUDGE_INTERVAL_MS = 2_000;
const NAVIGATION_SETTLE_MS = 400;
const GUEST_FALLBACK_COOLDOWN_MS = 5 * 60_000;
const TAB_FALLBACK_COOLDOWN_MS = 2 * 60_000;

/** Si la API pública falla, no la reintentamos en cada página durante un rato. */
let guestDisabledUntil = 0;
/** Si la pestaña autenticada falla, no la reintentamos en cada página. */
let tabDisabledUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Descarga el fragmento HTML del endpoint público de LinkedIn. */
async function fetchLinkedInGuestPage(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/** Espera a que la pestaña termine de cargar sin depender de eventos. */
async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("La pestaña de LinkedIn se cerró antes de cargar");
    if (tab.status === "complete") return;
    await sleep(300);
  }

  throw new Error(`LinkedIn tardó más de ${Math.round(timeoutMs / 1000)} s en cargar`);
}

/**
 * LinkedIn abre la búsqueda con la última oferta seleccionada (`currentJobId`).
 * En ese modo la página muestra el detalle y esconde el listado, así que se
 * recarga sin ese parámetro.
 */
async function dropSelectedJob(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const cleaned = tab?.url ? withoutCurrentJobId(tab.url) : undefined;
  if (!cleaned) return;

  await browser.tabs.update(tabId, { url: cleaned }).catch(() => undefined);
  // `tabs.update` resuelve antes de que arranque la navegación: sin esta pausa
  // se puede leer la página anterior, que ya estaba «complete».
  await sleep(NAVIGATION_SETTLE_MS);
  await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);
}

/** Empuja el listado para forzar el render perezoso de las tarjetas. */
async function nudgeList(tabId: number): Promise<void> {
  await browser.scripting
    .executeScript({ target: { tabId }, func: nudgeLinkedInList })
    .catch(() => undefined);
}

/**
 * Plan B: abre una pestaña inactiva y espera activamente a que LinkedIn pinte
 * las tarjetas. Se usa cuando el filtro de modalidad lo exige.
 */
async function scrapeLinkedInTab(
  query: string,
  filters: SearchFilters,
  page: number,
): Promise<ScraperResult> {
  const searchUrl = buildLinkedInSearchUrl(query, filters, page);
  let tabId: number | undefined;

  try {
    const tab = await browser.tabs.create({ url: searchUrl, active: false });
    tabId = tab.id;
    if (tabId === undefined) throw new Error("No se pudo abrir la pestaña de LinkedIn");

    await sleep(NAVIGATION_SETTLE_MS);
    await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);
    await dropSelectedJob(tabId);
    await nudgeList(tabId);

    const deadline = Date.now() + CARDS_WAIT_TIMEOUT_MS;
    let lastInspection: LinkedInPageInspection | undefined;
    let lastInjectionError: unknown;
    let fatalError: string | undefined;
    let lastNudgeAt = Date.now();

    while (Date.now() < deadline) {
      let inspection: LinkedInPageInspection | undefined;

      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          func: inspectLinkedInPage,
          args: [page],
        });
        inspection = results[0]?.result as LinkedInPageInspection | undefined;
      } catch (error) {
        lastInjectionError = error;
      }

      if (inspection) {
        lastInspection = inspection;

        if (inspection.jobs.length > 0) {
          const details = `${inspection.jobs.length} tarjetas detectadas; URL: ${inspection.url}`;

          if (filters.workMode && !inspection.authenticated) {
            fatalError = `LinkedIn no tiene una sesión iniciada, así que no se pudo aplicar el filtro de modalidad (${details})`;
            break;
          }

          const modalityApplied =
            filters.workMode !== undefined &&
            hasLinkedInWorkModeFilter(inspection.url, filters.workMode);

          if (filters.workMode && !modalityApplied) {
            // LinkedIn descartó `f_WT` al redirigir. Etiquetar todas las
            // tarjetas con la modalidad pedida devolvería ofertas presenciales,
            // así que solo se conservan las que la muestran explícitamente.
            const explicitMatches = normalizeInspectionJobs(inspection.jobs).filter(
              (job) => job.workMode === filters.workMode,
            );

            if (explicitMatches.length === 0) {
              fatalError = `LinkedIn descartó el filtro de modalidad al redirigir la búsqueda (${details})`;
              break;
            }

            return { jobs: explicitMatches, hasMore: false };
          }

          return {
            jobs: normalizeInspectionJobs(
              inspection.jobs,
              modalityApplied ? filters.workMode : undefined,
            ),
            // La página entrega una tanda completa de tarjetas; paginar con
            // start=25/50 suele terminar en el muro de login.
            hasMore: false,
          };
        }

        if (inspection.blocked) break;

        // LinkedIn contestó «no hay ofertas» con la sesión y el filtro activos:
        // es un cero legítimo, no un fallo de lectura.
        if (
          inspection.authenticated &&
          inspection.emptyState &&
          (!filters.workMode || hasLinkedInWorkModeFilter(inspection.url, filters.workMode))
        ) {
          return { jobs: [], hasMore: false };
        }
      }

      if (Date.now() - lastNudgeAt >= SCROLL_NUDGE_INTERVAL_MS) {
        lastNudgeAt = Date.now();
        await nudgeList(tabId);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const finalTab = await browser.tabs.get(tabId).catch(() => null);
    const url = lastInspection?.url ?? finalTab?.url ?? searchUrl;
    const details = [
      `${lastInspection?.cardCount ?? 0} tarjetas detectadas`,
      lastInspection
        ? `sesión ${lastInspection.authenticated ? "iniciada" : "no detectada"}`
        : undefined,
      lastInspection
        ? `listado ${lastInspection.listContainerFound ? "presente" : "ausente"}`
        : undefined,
      `URL: ${url}`,
    ]
      .filter(Boolean)
      .join("; ");

    if (fatalError) throw new Error(fatalError);
    if (lastInspection?.blocked) {
      throw new Error(`LinkedIn mostró un muro de inicio de sesión (${details})`);
    }
    if (lastInjectionError) {
      throw new Error(
        `No se pudo leer la pestaña de LinkedIn (${details}): ${errorMessage(lastInjectionError)}`,
      );
    }
    throw new Error(`LinkedIn no mostró ofertas en la pestaña (${details})`);
  } finally {
    if (tabId !== undefined) {
      try {
        await browser.tabs.remove(tabId);
      } catch {
        // La pestaña ya estaba cerrada.
      }
    }
  }
}

/**
 * Scraper de LinkedIn.
 *
 * El endpoint público (`seeMoreJobPostings`) no respeta el filtro de modalidad
 * `f_WT` ni incluye la modalidad en las tarjetas; solo la búsqueda con sesión
 * iniciada lo hace. Por eso, cuando se pide una modalidad, se intenta primero
 * la pestaña inactiva. La consulta pública queda como respaldo y el servicio
 * aplica después el filtro estricto sobre lo que se haya podido detectar.
 */
export async function scrapeLinkedIn(
  query: string,
  filters: SearchFilters,
  page: number = 0,
): Promise<ScraperResult> {
  const warnings: string[] = [];

  const tryTab = async (): Promise<ScraperResult | undefined> => {
    if (Date.now() < tabDisabledUntil) {
      // El enfriamiento es interno: avisar en cada página duplicaría el aviso
      // del fallo que lo provocó sin aportar nada al usuario.
      console.debug("[LinkedIn Scraper] Búsqueda en pestaña en enfriamiento; se omite.");
      return undefined;
    }

    try {
      return await scrapeLinkedInTab(query, filters, page);
    } catch (error) {
      tabDisabledUntil = Date.now() + TAB_FALLBACK_COOLDOWN_MS;
      warnings.push(
        filters.workMode
          ? `La búsqueda con modalidad en LinkedIn falló (${errorMessage(
              error,
            )}). Se usará la consulta pública y solo se mostrarán las ofertas con modalidad confirmada.`
          : errorMessage(error),
      );
      return undefined;
    }
  };

  if (filters.workMode) {
    const tabResult = await tryTab();
    if (tabResult) return tabResult;
  }

  if (Date.now() >= guestDisabledUntil) {
    try {
      const guestUrl = buildLinkedInGuestSearchUrl(query, filters, page);
      const html = await fetchLinkedInGuestPage(guestUrl);
      const jobs = parseLinkedInJobsHtml(html, page);

      if (jobs.length > 0) {
        return {
          jobs,
          hasMore: jobs.length >= LINKEDIN_GUEST_PAGE_SIZE,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      }

      warnings.push("La consulta pública no devolvió ofertas.");
      console.warn(`[LinkedIn Scraper] La API pública no devolvió tarjetas (página ${page}).`);
    } catch (error) {
      guestDisabledUntil = Date.now() + GUEST_FALLBACK_COOLDOWN_MS;
      warnings.push(`La consulta pública falló (${errorMessage(error)}).`);
      console.warn("[LinkedIn Scraper] Falló la API pública:", errorMessage(error));
    }
  } else {
    console.debug("[LinkedIn Scraper] Consulta pública en enfriamiento; se omite.");
  }

  if (!filters.workMode) {
    const tabResult = await tryTab();
    if (tabResult) return tabResult;
  }

  return { jobs: [], hasMore: false, ...(warnings.length > 0 ? { warnings } : {}) };
}
