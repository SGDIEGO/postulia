import { browser } from "wxt/browser";
import type { SearchFilters } from "@postulia/shared";
import type { ScrapedJob, ScraperResult } from "./scrapers.js";
import {
  buildLinkedInGuestSearchUrl,
  buildLinkedInSearchUrl,
  parseLinkedInJobsHtml,
  LINKEDIN_GUEST_PAGE_SIZE,
} from "./linkedin-parser.js";

const TAB_LOAD_TIMEOUT_MS = 30_000;
const CARDS_WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 500;
const GUEST_FALLBACK_COOLDOWN_MS = 5 * 60_000;

/** Si la API pública falla, no la reintentamos en cada página durante un rato. */
let guestDisabledUntil = 0;

interface LinkedInPageInspection {
  jobs: ScrapedJob[];
  cardCount: number;
  url: string;
  title: string;
  blocked: boolean;
}

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
 * Plan B: abre una pestaña inactiva y espera activamente a que LinkedIn pinte
 * las tarjetas. Se usa solo si la consulta pública no devuelve resultados.
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

    await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);

    const deadline = Date.now() + CARDS_WAIT_TIMEOUT_MS;
    let lastInspection: LinkedInPageInspection | undefined;
    let lastInjectionError: unknown;

    while (Date.now() < deadline) {
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          func: inspectLinkedInPage,
          args: [page],
        });
        const inspection = results[0]?.result as LinkedInPageInspection | undefined;

        if (inspection) {
          lastInspection = inspection;
          if (inspection.jobs.length > 0) {
            return {
              jobs: inspection.jobs,
              // La página pública ya entrega una tanda completa de tarjetas.
              // Paginar con start=25/50 suele terminar en el muro de login.
              hasMore: false,
            };
          }
          if (inspection.blocked) break;
        }
      } catch (error) {
        lastInjectionError = error;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const finalTab = await browser.tabs.get(tabId).catch(() => null);
    const url = lastInspection?.url ?? finalTab?.url ?? searchUrl;
    const title = lastInspection?.title ?? finalTab?.title ?? "";
    const details = `${lastInspection?.cardCount ?? 0} tarjetas detectadas; URL: ${url}${
      title ? `; título: ${title}` : ""
    }`;

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
 * Primero consulta el endpoint público que usa la propia web de LinkedIn
 * (`seeMoreJobPostings`), sin cookies ni renderizado. Si no devuelve tarjetas
 * o falla, usa la pestaña inactiva como respaldo.
 */
export async function scrapeLinkedIn(
  query: string,
  filters: SearchFilters,
  page: number = 0,
): Promise<ScraperResult> {
  let guestError: string | null = null;
  let guestEmpty = false;

  if (Date.now() >= guestDisabledUntil) {
    try {
      const guestUrl = buildLinkedInGuestSearchUrl(query, filters, page);
      const html = await fetchLinkedInGuestPage(guestUrl);
      const jobs = parseLinkedInJobsHtml(html, page, filters.workMode);

      if (jobs.length > 0) {
        return { jobs, hasMore: jobs.length >= LINKEDIN_GUEST_PAGE_SIZE };
      }

      guestEmpty = true;
      console.warn(`[LinkedIn Scraper] La API pública no devolvió tarjetas (página ${page}).`);
    } catch (error) {
      guestError = errorMessage(error);
      guestDisabledUntil = Date.now() + GUEST_FALLBACK_COOLDOWN_MS;
      console.warn("[LinkedIn Scraper] Falló la API pública:", guestError);
    }
  }

  try {
    const result = await scrapeLinkedInTab(query, filters, page);
    // Si la pestaña funcionó, no mostramos un aviso por el fallo del intento
    // anterior: el usuario ya tiene resultados.
    return result;
  } catch (error) {
    const warnings: string[] = [];
    if (guestError) warnings.push(`La consulta pública falló (${guestError}).`);
    else if (guestEmpty) warnings.push("La consulta pública no devolvió ofertas.");
    warnings.push(errorMessage(error));

    return { jobs: [], hasMore: false, warnings };
  }
}

/**
 * Función que se ejecuta en el contexto de la página de LinkedIn.
 *
 * Debe ser autocontenida: `scripting.executeScript` la serializa y la ejecuta
 * en la pestaña, por lo que no puede referenciar variables del módulo.
 */
function inspectLinkedInPage(page: number): LinkedInPageInspection {
  const jobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();

  const cards = document.querySelectorAll<HTMLElement>(
    "li.jobs-search-results__list-item, li.scaffold-layout__list-item, .job-search-card, [data-job-id]",
  );

  cards.forEach((card, index) => {
    try {
      const titleEl = card.querySelector<HTMLElement>(
        "a.job-card-container__link, .job-card-list__title, h3 a, .job-search-card__title a, .base-search-card__title, [data-job-title]",
      );
      const title = (titleEl?.textContent ?? titleEl?.getAttribute("aria-label") ?? "").trim();

      const companyEl = card.querySelector<HTMLElement>(
        ".job-card-container__company-name, .artdeco-entity-lockup__subtitle, h4 a, .job-search-card__subtitle a, .base-search-card__subtitle, [data-company-name]",
      );
      const company = (companyEl?.textContent ?? "").trim();

      const linkEl = card.querySelector<HTMLAnchorElement>(
        'a[href*="/jobs/view/"], a.job-card-container__link, a.base-card__full-link, h3 a',
      );
      const href = linkEl?.getAttribute("href") ?? "";
      const jobIdMatch = href.match(/\/jobs\/view\/(?:.*-)?(\d+)/);
      const jobId =
        jobIdMatch?.[1] ?? linkEl?.getAttribute("data-job-id") ?? card.getAttribute("data-job-id");
      const url = jobId
        ? `https://www.linkedin.com/jobs/view/${jobId}/`
        : (href.split("?")[0] ?? "");

      const locationEl = card.querySelector<HTMLElement>(
        ".job-card-container__metadata-item, .job-search-card__location, .job-result-card__location, [data-job-location]",
      );
      const location = (locationEl?.textContent ?? "").trim() || undefined;

      const workModeEl = card.querySelector<HTMLElement>(
        ".job-search-card__workplace-type, .job-search-card__work-type, .job-result-card__work-type, [data-work-type]",
      );
      const workModeText = (workModeEl?.textContent ?? "").toLowerCase();
      const workMode = workModeText
        ? workModeText.includes("remot")
          ? "remote"
          : workModeText.includes("hibrid") || workModeText.includes("hybrid")
            ? "hybrid"
            : workModeText.includes("presencial") || workModeText.includes("onsite")
              ? "onsite"
              : undefined
        : undefined;

      const dateEl = card.querySelector<HTMLTimeElement>(
        "time[datetime], .job-search-card__listdate, .job-card-container__listdate",
      );
      const postedAt = dateEl?.getAttribute("datetime") ?? undefined;

      if (!title || !company || !url || seenUrls.has(url)) return;

      seenUrls.add(url);
      jobs.push({
        jobTitle: title,
        company,
        url,
        source: "linkedin",
        location,
        workMode,
        postedAt,
        confidence: location ? "high" : "medium",
        pageNumber: page,
        positionInPage: index,
      });
    } catch {
      // Ignorar tarjetas individuales con datos incompletos.
    }
  });

  const bodyText = (document.body?.innerText ?? "").slice(0, 3_000);
  const blocked =
    /\/(authwall|checkpoint|login)/.test(window.location.href) ||
    (/sign in|iniciar sesión|join linkedin|unirse a linkedin/i.test(bodyText) && jobs.length === 0);

  return {
    jobs,
    cardCount: cards.length,
    url: window.location.href,
    title: document.title,
    blocked,
  };
}
