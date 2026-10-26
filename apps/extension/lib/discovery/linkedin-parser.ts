import * as cheerio from "cheerio";
import {
  detectWorkModeFromText,
  parseWorkModeLabel,
  type SearchFilters,
  type WorkMode,
} from "@postulia/shared";
import type { ScrapedJob } from "./scrapers.js";
import { buildPortalLocation, resolveCountry } from "./location.js";

export const LINKEDIN_ORIGIN = "https://www.linkedin.com";
export const LINKEDIN_JOBS_PER_PAGE = 25;
export const LINKEDIN_GUEST_PAGE_SIZE = 10;

const LINKEDIN_WORK_MODE: Record<WorkMode, string> = {
  onsite: "1",
  remote: "2",
  hybrid: "3",
};

function addSearchFilters(params: URLSearchParams, filters: SearchFilters): void {
  // LinkedIn no reconoce el país en español: `location=Perú` devuelve ofertas
  // de Estados Unidos. Se envía la ubicación normalizada (país en inglés).
  const location = buildPortalLocation(filters.location);
  if (location) params.set("location", location);

  if (filters.postedWithinDays && filters.postedWithinDays > 0) {
    params.set("f_TPR", `r${Math.round(filters.postedWithinDays * 86_400)}`);
  }

  if (filters.workMode) {
    params.set("f_WT", LINKEDIN_WORK_MODE[filters.workMode]);
  }
}

/**
 * URL de la página de resultados (la que usa la pestaña de respaldo).
 *
 * Se apunta directamente a `/jobs/search-results/`: LinkedIn redirige ahí desde
 * `/jobs/search/` y en esa redirección pierde `f_WT`, con lo que la búsqueda
 * dejaba de estar filtrada por modalidad.
 */
export function buildLinkedInSearchUrl(
  query: string,
  filters: SearchFilters,
  page: number,
): string {
  const params = new URLSearchParams({
    keywords: query,
    start: String(page * LINKEDIN_JOBS_PER_PAGE),
  });
  addSearchFilters(params, filters);
  return `${LINKEDIN_ORIGIN}/jobs/search-results/?${params.toString()}`;
}

/** Indica si la URL conserva el filtro nativo de modalidad pedido. */
export function hasLinkedInWorkModeFilter(rawUrl: string, workMode: WorkMode): boolean {
  try {
    const values = new URL(rawUrl).searchParams
      .getAll("f_WT")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim());
    return values.includes(LINKEDIN_WORK_MODE[workMode]);
  } catch {
    return false;
  }
}

/**
 * Devuelve la URL sin `currentJobId`, que hace que LinkedIn abra la vista de
 * detalle y oculte el listado. `undefined` si no hay nada que quitar.
 */
export function withoutCurrentJobId(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("currentJobId")) return undefined;
    url.searchParams.delete("currentJobId");
    return url.toString();
  } catch {
    return undefined;
  }
}

/** URL del endpoint público que usa la propia web de LinkedIn para paginar. */
export function buildLinkedInGuestSearchUrl(
  query: string,
  filters: SearchFilters,
  page: number,
): string {
  const params = new URLSearchParams({
    keywords: query,
    start: String(page * LINKEDIN_GUEST_PAGE_SIZE),
  });
  addSearchFilters(params, filters);
  return `${LINKEDIN_ORIGIN}/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
}

function linkedInJobId(card: cheerio.Cheerio<any>, href: string): string | undefined {
  const hrefMatch = href.match(/\/jobs\/view\/(?:.*-)?(\d+)/);
  if (hrefMatch?.[1]) return hrefMatch[1];

  const urn =
    card.attr("data-entity-urn") ??
    card.find("[data-entity-urn]").first().attr("data-entity-urn") ??
    "";
  const urnMatch = urn.match(/jobPosting:(\d+)/);
  if (urnMatch?.[1]) return urnMatch[1];

  return card.attr("data-job-id") ?? card.find("[data-job-id]").first().attr("data-job-id");
}

/**
 * Parsea las tarjetas de LinkedIn (tanto el HTML completo de búsqueda como el
 * fragmento del endpoint guest). Es una función pura para poder testearla.
 */
export function parseLinkedInJobsHtml(html: string, page: number = 0): ScrapedJob[] {
  const $ = cheerio.load(html);
  const jobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();

  const cards = $(
    ".job-search-card, li.jobs-search-results__list-item, li.scaffold-layout__list-item, [data-entity-urn*='jobPosting'], [data-job-id]",
  );

  cards.each((index, element) => {
    const card = $(element);

    const title = card
      .find(
        ".base-search-card__title, .job-search-card__title, h3 a, .job-card-list__title, .job-card-container__link",
      )
      .first()
      .text()
      .trim();

    const company = card
      .find(
        ".base-search-card__subtitle a, .base-search-card__subtitle, h4 a, .job-card-container__company-name, .artdeco-entity-lockup__subtitle",
      )
      .first()
      .text()
      .trim();

    const linkEl = card
      .find('a.base-card__full-link, a[href*="/jobs/view/"], a.job-card-container__link, h3 a')
      .first();
    const href = (linkEl.attr("href") ?? "").trim();
    const jobId = linkedInJobId(card, href);
    const url = jobId ? `${LINKEDIN_ORIGIN}/jobs/view/${jobId}/` : (href.split("?")[0] ?? "");

    const location = card
      .find(
        ".job-search-card__location, .job-card-container__metadata-item, .job-result-card__location",
      )
      .first()
      .text()
      .trim();

    const workModeText = card
      .find(
        ".job-search-card__workplace-type, .job-search-card__work-type, .job-result-card__work-type",
      )
      .first()
      .text()
      .trim();

    const postedAt =
      card.find("time[datetime]").first().attr("datetime") ??
      card
        .find(".job-search-card__listdate, .job-card-container__listdate")
        .first()
        .attr("datetime") ??
      undefined;

    if (!title || !company || !url || seenUrls.has(url)) return;

    seenUrls.add(url);
    const workMode =
      parseWorkModeLabel(workModeText) ?? detectWorkModeFromText(`${title} ${location}`);

    jobs.push({
      jobTitle: title,
      company,
      url,
      source: "linkedin",
      location: location || undefined,
      country: resolveCountry(location)?.code,
      workMode: workMode?.workMode,
      workModeSource: workMode?.source ?? "unknown",
      workModeConfidence: workMode?.confidence ?? "low",
      postedAt,
      confidence: title && company && location ? "high" : "medium",
      pageNumber: page,
      positionInPage: index,
    });
  });

  return jobs;
}
