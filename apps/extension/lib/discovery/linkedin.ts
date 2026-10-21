import { browser } from "wxt/browser";
import type { ScrapedJob, ScraperResult } from "./scrapers.js";
import { newId, nowIso, type Source, type WorkMode } from "@postulia/shared";
import { hashJobUrl } from "./queue.js";

const OFFSCREEN_URL = "/offscreen.js";

/** Crea documento offscreen para LinkedIn. */
async function ensureOffscreenDocument(): Promise<void> {
  const existing = await browser.offscreen.hasDocument();
  if (existing) return;

  await browser.offscreen.createDocument({
    url: browser.runtime.getURL(OFFSCREEN_URL),
    reasons: ["DOM_PARSER"],
    justification: "Scraping LinkedIn job listings (SPA requiere DOM real)",
  });

  // Esperar a que el documento esté listo
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Inyecta script de scraping en offscreen document. */
async function runLinkedInScraperInOffscreen(
  query: string,
  location: string,
  page: number
): Promise<ScraperResult> {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("LinkedIn scraper timeout (30s)"));
    }, 30_000);

    const handleResponse = (response: { result?: ScraperResult; error?: string }) => {
      clearTimeout(timeout);
      browser.runtime.onMessage.removeListener(handleResponse);
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.result!);
      }
    };

    browser.runtime.onMessage.addListener(handleResponse);

    browser.runtime.sendMessage({
      type: "discovery:linkedin:scrape",
      query,
      location,
      page,
    });
  });
}

/** Handler en offscreen document (se registra en offscreen.js). */
export async function handleLinkedInScrape(
  query: string,
  location: string,
  page: number
): Promise<ScraperResult> {
  // Crear pestaña oculta para LinkedIn
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&f_TPR=r604800&start=${page * 25}`;

  const tab = await browser.tabs.create({
    url: searchUrl,
    active: false,
    pinned: true,
  });

  try {
    // Esperar a que cargue
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Inyectar content script para extraer
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractLinkedInJobs,
      args: [page],
    });

    const jobs = results[0]?.result as ScrapedJob[] || [];

    return {
      jobs,
      hasMore: jobs.length >= 25,
    };
  } finally {
    // Cerrar pestaña
    try {
      await browser.tabs.remove(tab.id!);
    } catch {}
  }
}

/** Función que se ejecuta en el contexto de la página LinkedIn. */
function extractLinkedInJobs(page: number): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];

  // Selectores de LinkedIn (pueden cambiar)
  const jobCards = document.querySelectorAll(
    "[data-job-id], .job-search-card, .jobs-search-results__list-item, li.jobs-search-results__list-item"
  );

  jobCards.forEach((card, index) => {
    try {
      // Título
      const titleEl = card.querySelector(
        "h3 a, .job-search-card__title a, [data-job-title]"
      );
      const title = titleEl?.textContent?.trim() || titleEl?.getAttribute("aria-label") || "";

      // Empresa
      const companyEl = card.querySelector(
        "h4 a, .job-search-card__subtitle a, [data-company-name]"
      );
      const company = companyEl?.textContent?.trim() || "";

      // URL
      const linkEl = card.querySelector("a[data-job-id], .job-search-card__title a, h3 a");
      const href = linkEl?.getAttribute("href") || "";
      const jobIdMatch = href.match(/\/jobs\/view\/(\d+)/);
      const jobId = jobIdMatch?.[1] || linkEl?.getAttribute("data-job-id");
      const url = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : href;

      // Ubicación
      const locationEl = card.querySelector(
        ".job-search-card__location, [data-job-location], .job-result-card__location"
      );
      const location = locationEl?.textContent?.trim();

      // Modalidad
      const workModeEl = card.querySelector(
        ".job-search-card__work-type, [data-work-type], .job-result-card__work-type"
      );
      const workModeText = workModeEl?.textContent?.trim();
      const workMode = workModeText
        ? workModeText.toLowerCase().includes("remoto") || workModeText.toLowerCase().includes("remote")
          ? "remote"
          : workModeText.toLowerCase().includes("hibrido") || workModeText.toLowerCase().includes("hybrid")
            ? "hybrid"
            : "onsite"
        : undefined;

      if (title && company && url) {
        jobs.push({
          jobTitle: title,
          company,
          url,
          source: "linkedin",
          location,
          workMode,
          confidence: title && company && location ? "high" : "medium",
          pageNumber: page,
          positionInPage: index,
        });
      }
    } catch {
      // Ignorar errores en tarjetas individuales
    }
  });

  return jobs;
}

/** Scraper principal para LinkedIn usando offscreen. */
export async function scrapeLinkedIn(
  query: string,
  location: string,
  page: number = 0
): Promise<ScraperResult> {
  try {
    return await runLinkedInScraperInOffscreen(query, location, page);
  } catch (error) {
    console.error("[LinkedIn Scraper] Error:", error);
    // Fallback: intentar JSON-LD público si existe
    return { jobs: [], hasMore: false };
  }
}