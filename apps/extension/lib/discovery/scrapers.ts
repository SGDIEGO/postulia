import * as cheerio from "cheerio";
import type { SearchFilters, Source, WorkMode } from "@postulia/shared";
import { hashJobUrl } from "./queue.js";

export interface ScrapedJob {
  jobTitle: string;
  company: string;
  url: string;
  source: Source;
  location?: string;
  workMode?: WorkMode;
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
}

/** Normaliza salario a formato consistente. */
function normalizeSalary(text: string | undefined): { salary?: string; currency?: string } {
  if (!text) return {};
  const cleaned = text.replace(/[^\d.,$\s€£]/g, "").trim();
  const currencyMatch = cleaned.match(/[$€£]|(?:USD|EUR|GBP|COP|MXN|ARS|CLP|PEN|UYU)/i);
  const currency = currencyMatch?.[0]?.toUpperCase();
  const salary = cleaned.replace(/[$€£]/g, "").trim() || undefined;
  return { salary, currency };
}

/** Detecta modalidad de trabajo del texto. */
function detectWorkMode(text: string | undefined): WorkMode | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (
    lower.includes("remoto") ||
    lower.includes("remote") ||
    lower.includes("teletrabajo") ||
    lower.includes("home office")
  ) {
    return "remote";
  }
  if (lower.includes("hibrido") || lower.includes("híbrido") || lower.includes("hybrid")) {
    return "hybrid";
  }
  if (lower.includes("presencial") || lower.includes("onsite") || lower.includes("on-site")) {
    return "onsite";
  }
  return undefined;
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
  const baseUrl = "https://co.indeed.com/jobs";
  const days =
    filters.postedWithinDays && filters.postedWithinDays > 0 ? filters.postedWithinDays : 7;
  const params = new URLSearchParams({
    q: query,
    l: filters.location ?? "",
    start: String(page * 10),
    sort: "date",
    fromage: String(days),
  });
  const url = `${baseUrl}?${params.toString()}`;

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

    const workMode = detectWorkMode(`${location} ${snippet}`);

    if (title && company) {
      jobs.push({
        jobTitle: title,
        company,
        url: `https://co.indeed.com/viewjob?jk=${jk}`,
        source: "indeed",
        location: location || undefined,
        workMode,
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
  _filters: SearchFilters,
  page: number = 1,
): Promise<ScraperResult> {
  const baseUrl = "https://co.computrabajo.com/ofertas-de-trabajo/";
  const params = new URLSearchParams({
    q: query,
    p: String(page),
  });
  const url = `${baseUrl}?${params.toString()}`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const jobs: ScrapedJob[] = [];

  // Computrabajo: cada oferta está en .box_offer o similar
  $(".box_offer, .offer, [data-id]").each((index, element) => {
    const $el = $(element);

    // Título y URL
    const linkEl = $el.find("h2 a, h3 a, .offer-title a").first();
    const title = linkEl.text().trim();
    const href = linkEl.attr("href");

    if (!title || !href) return;

    // Empresa
    const companyEl = $el.find(".company a, .fc_base a, [data-company]").first();
    const company = companyEl.text().trim();

    // Ubicación
    const locationEl = $el.find(".location, .fs13, .fc_base").first();
    const location = locationEl.text().trim();

    // Salario
    const salaryEl = $el.find(".salary, .fs16").first();
    const { salary, currency } = normalizeSalary(salaryEl.text());

    // Modalidad
    const snippet = $el.text();
    const workMode = detectWorkMode(`${location} ${snippet}`);

    const fullUrl = href.startsWith("http") ? href : `https://co.computrabajo.com${href}`;

    if (title && company) {
      jobs.push({
        jobTitle: title,
        company,
        url: fullUrl,
        source: "computrabajo",
        location: location || undefined,
        workMode,
        salary,
        currency,
        postedAt: undefined,
        confidence: title && company && location ? "high" : "medium",
        pageNumber: page,
        positionInPage: index,
      });
    }
  });

  // Paginación
  const hasMore = $(".pagination .next, .pagination a[rel='next']").length > 0 && jobs.length > 0;

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

            jobs.push({
              jobTitle: jobPosting.title || "Sin título",
              company: jobPosting.hiringOrganization?.name || "Sin empresa",
              url: jobUrl,
              source,
              location: jobPosting.jobLocation?.address?.addressLocality,
              workMode: jobPosting.jobLocationType?.toString().includes("TELECOMMUTE")
                ? "remote"
                : undefined,
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
