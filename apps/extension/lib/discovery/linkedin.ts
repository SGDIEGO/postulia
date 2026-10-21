import { browser } from "wxt/browser";
import type { SearchFilters } from "@postulia/shared";
import type { ScrapedJob, ScraperResult } from "./scrapers.js";

const LINKEDIN_ORIGIN = "https://www.linkedin.com";
const PAGE_LOAD_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_500;
const JOBS_PER_PAGE = 25;

/** Construye la URL de búsqueda pública de LinkedIn. */
export function buildLinkedInSearchUrl(
  query: string,
  filters: SearchFilters,
  page: number,
): string {
  const params = new URLSearchParams({
    keywords: query,
    location: filters.location ?? "",
    start: String(page * JOBS_PER_PAGE),
  });

  if (filters.postedWithinDays && filters.postedWithinDays > 0) {
    params.set("f_TPR", `r${Math.round(filters.postedWithinDays * 86_400)}`);
  }

  return `${LINKEDIN_ORIGIN}/jobs/search/?${params.toString()}`;
}

/** Espera a que la pestaña termine de cargar (o falla por timeout). */
async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const current = await browser.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`LinkedIn tardó más de ${Math.round(timeoutMs / 1000)}s en cargar`));
    }, timeoutMs);

    const onUpdated = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };

    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Scraper de LinkedIn.
 *
 * Se ejecuta en el service worker: abre una pestaña inactiva, espera a que
 * LinkedIn pinte las tarjetas, inyecta el extractor y cierra la pestaña. El
 * offscreen document no sirve para esto porque solo tiene acceso a runtime.
 */
export async function scrapeLinkedIn(
  query: string,
  filters: SearchFilters,
  page: number = 0,
): Promise<ScraperResult> {
  const searchUrl = buildLinkedInSearchUrl(query, filters, page);
  let tabId: number | undefined;

  try {
    const tab = await browser.tabs.create({ url: searchUrl, active: false });
    tabId = tab.id;
    if (tabId === undefined) throw new Error("No se pudo abrir la pestaña de LinkedIn");

    await waitForTabComplete(tabId, PAGE_LOAD_TIMEOUT_MS);
    // LinkedIn renderiza las tarjetas después de "complete".
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: extractLinkedInJobs,
      args: [page],
    });

    const jobs = Array.isArray(results[0]?.result) ? (results[0].result as ScrapedJob[]) : [];

    if (jobs.length === 0) {
      const finalTab = await browser.tabs.get(tabId).catch(() => null);
      if (finalTab?.url && /\/(authwall|checkpoint|login)/.test(finalTab.url)) {
        console.warn(
          "[LinkedIn Scraper] LinkedIn pidió iniciar sesión; no hay ofertas para extraer.",
        );
      }
    }

    return { jobs, hasMore: jobs.length >= JOBS_PER_PAGE };
  } catch (error) {
    console.error("[LinkedIn Scraper] Error:", error);
    return { jobs: [], hasMore: false };
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
 * Función que se ejecuta en el contexto de la página de LinkedIn.
 *
 * Debe ser autocontenida: `scripting.executeScript` la serializa y la ejecuta
 * en la pestaña, por lo que no puede referenciar variables del módulo.
 */
function extractLinkedInJobs(page: number): ScrapedJob[] {
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
      const jobIdMatch = href.match(/\/jobs\/view\/(\d+)/);
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

  return jobs;
}
