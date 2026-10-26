import * as cheerio from "cheerio";
import {
  detectWorkModeFromText,
  type SearchFilters,
  type Source,
  type WorkMode,
  type WorkModeConfidence,
  type WorkModeSource,
} from "@postulia/shared";
import { buildIndeedSearchUrl } from "./indeed-url.js";
import { buildComputrabajoSearchUrl } from "./computrabajo-url.js";
import { hasComputrabajoNextPage, parseComputrabajoHtml } from "./computrabajo-parser.js";
import { resolveCountry } from "./location.js";
import { normalizeSalary } from "./salary.js";

export interface ScrapedJob {
  jobTitle: string;
  company: string;
  url: string;
  source: Source;
  location?: string;
  /** País del portal (ISO) cuando el dominio lo determina. */
  country?: string;
  workMode?: WorkMode;
  workModeSource?: WorkModeSource;
  workModeConfidence?: WorkModeConfidence;
  salary?: string;
  currency?: string;
  postedAt?: string;
  confidence: "high" | "medium" | "low";
  pageNumber: number;
  positionInPage: number;
}

export interface ScraperResult {
  jobs: ScrapedJob[];
  hasMore: boolean;
  nextPageUrl?: string;
  /** Avisos no fatales (p. ej. un portal no pudo leerse pero otro sí). */
  warnings?: string[];
}

/** Scraper base con lógica común. */
async function fetchHtml(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      ...headers,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }

  return response.text();
}

/** Scraper para Indeed. */
export async function scrapeIndeed(
  query: string,
  filters: SearchFilters,
  page: number = 0,
): Promise<ScraperResult> {
  const url = buildIndeedSearchUrl(query, filters, page);
  const country = resolveCountry(filters.location);
  const origin = new URL(url).origin;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const jobs: ScrapedJob[] = [];

  // Indeed usa data-jk para el ID de la oferta
  $("[data-jk]").each((index, element) => {
    const $el = $(element);
    const jk = $el.attr("data-jk");
    if (!jk) return;

    const titleEl = $el.find("h2 a span, h2 span[title]").first();
    const title = titleEl.attr("title") || titleEl.text().trim();

    const companyEl = $el
      .find("[data-testid='company-name'], .companyName, [data-company-name]")
      .first();
    const company = companyEl.text().trim();

    const locationEl = $el.find("[data-testid='job-location'], .companyLocation").first();
    const location = locationEl.text().trim();

    const salaryEl = $el
      .find("[data-testid='attribute_snippet_testid'], .salary-snippet, .estimated-salary")
      .first();
    const { salary, currency } = normalizeSalary(salaryEl.text());

    const snippetEl = $el.find(".job-snippet, .summary").first();
    const snippet = snippetEl.text().trim();

    const workMode =
      detectWorkModeFromText(`${title} ${location}`) ??
      detectWorkModeFromText(snippet, { requireExplicit: true });
    // Indeed aplica el filtro de modalidad en la propia búsqueda. Si la tarjeta
    // no lo repite, se usa el filtro solicitado en lugar de descartar la oferta.
    const portalWorkMode =
      filters.workMode === "remote" || filters.workMode === "hybrid" ? filters.workMode : undefined;
    const resolvedWorkMode =
      workMode ??
      (portalWorkMode
        ? { workMode: portalWorkMode, source: "portal" as const, confidence: "medium" as const }
        : undefined);

    if (title && company) {
      jobs.push({
        jobTitle: title,
        company,
        url: `${origin}/viewjob?jk=${jk}`,
        source: "indeed",
        location: location || undefined,
        country: country?.code,
        workMode: resolvedWorkMode?.workMode,
        workModeSource: resolvedWorkMode?.source ?? "unknown",
        workModeConfidence: resolvedWorkMode?.confidence ?? "low",
        salary,
        currency,
        postedAt: undefined, // Indeed no expone fecha fácilmente en listado
        confidence: title && company && location ? "high" : "medium",
        pageNumber: page,
        positionInPage: index,
      });
    }
  });

  // Verificar si hay más páginas
  const nextPage = $(".pagination a[data-testid='pagination-page-next']").length > 0;
  const hasMore = jobs.length > 0 && nextPage;

  return { jobs, hasMore };
}

/** Scraper para Computrabajo. */
export async function scrapeComputrabajo(
  query: string,
  filters: SearchFilters,
  page: number = 0,
): Promise<ScraperResult> {
  const country = resolveCountry(filters.location);
  if (country && !country.computrabajoHost) {
    return {
      jobs: [],
      hasMore: false,
      warnings: [`${country.nameEs} no tiene portal en Computrabajo.`],
    };
  }

  const url = buildComputrabajoSearchUrl(query, filters, page);
  if (!url) return { jobs: [], hasMore: false };

  const host = country?.computrabajoHost ?? "co.computrabajo.com";

  const html = await fetchHtml(url);
  const jobs = parseComputrabajoHtml(html, page, `https://${host}`).map((job) => ({
    ...job,
    country: country?.code,
  }));
  const hasMore = jobs.length > 0 && hasComputrabajoNextPage(html);

  return { jobs, hasMore };
}

/** Scraper genérico para portales con JSON-LD en listado. */
export async function scrapeJsonLdList(
  url: string,
  source: Source,
  page: number,
): Promise<ScraperResult> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const jobs: ScrapedJob[] = [];

  // Buscar JSON-LD en la página
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const data = JSON.parse($(script).html() || "{}");
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item["@type"] === "ItemList" && Array.isArray(item.itemListElement)) {
          for (const [index, element] of item.itemListElement.entries()) {
            const jobPosting = element.item?.["@type"] === "JobPosting" ? element.item : null;
            if (!jobPosting) continue;

            const jobUrl = jobPosting.url || jobPosting["@id"];
            if (!jobUrl) continue;

            const { salary, currency } = normalizeSalary(
              jobPosting.baseSalary?.value?.value?.toString(),
            );

            const isRemote = jobPosting.jobLocationType
              ?.toString()
              .toUpperCase()
              .includes("TELECOMMUTE");

            jobs.push({
              jobTitle: jobPosting.title || "Sin título",
              company: jobPosting.hiringOrganization?.name || "Sin empresa",
              url: jobUrl,
              source,
              location: jobPosting.jobLocation?.address?.addressLocality,
              workMode: isRemote ? "remote" : undefined,
              workModeSource: isRemote ? "jsonld" : "unknown",
              workModeConfidence: isRemote ? "high" : "low",
              salary,
              currency,
              postedAt: jobPosting.datePosted,
              confidence: "high",
              pageNumber: page,
              positionInPage: index,
            });
          }
        }
      }
    } catch {
      // JSON-LD inválido, ignorar
    }
  });

  return { jobs, hasMore: false };
}

/** Mapea source a función scraper. */
export const SCRAPERS: Record<
  Source,
  (query: string, filters: SearchFilters, page: number) => Promise<ScraperResult>
> = {
  indeed: scrapeIndeed,
  computrabajo: scrapeComputrabajo,
  linkedin: async () => ({ jobs: [], hasMore: false }), // LinkedIn se maneja en linkedin.ts
  bumeran: async () => ({ jobs: [], hasMore: false }),
  getonbrd: async () => ({ jobs: [], hasMore: false }),
  torre: async () => ({ jobs: [], hasMore: false }),
  other: async () => ({ jobs: [], hasMore: false }),
};

/** Ejecuta scraping para un source específico. */
export async function scrapeSource(
  source: Source,
  query: string,
  filters: SearchFilters,
  page: number,
): Promise<ScraperResult> {
  const scraper = SCRAPERS[source];
  if (!scraper) {
    return { jobs: [], hasMore: false };
  }
  return scraper(query, filters, page);
}
