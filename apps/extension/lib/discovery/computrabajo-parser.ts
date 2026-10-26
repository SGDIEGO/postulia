import * as cheerio from "cheerio";
import { detectWorkModeFromText } from "@postulia/shared";
import type { ScrapedJob } from "./scrapers.js";
import { normalizeSalary } from "./salary.js";

function cleanText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Convierte «Hace 7 días», «Hoy» o «Ayer» en una fecha ISO. */
export function parseComputrabajoDate(text?: string | null): string | undefined {
  const value = cleanText(text).toLowerCase();
  if (!value) return undefined;

  const now = Date.now();
  if (/^(hoy|today)\b/.test(value)) return new Date(now).toISOString();
  if (/^(ayer|yesterday)\b/.test(value)) return new Date(now - 86_400_000).toISOString();

  const match = value.match(/hace\s+(\d+)\s+(minuto|hora|d[ií]a|semana|mes|a[nñ]o)/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const unitMs = unit.startsWith("minuto")
    ? 60_000
    : unit.startsWith("hora")
      ? 3_600_000
      : unit.startsWith("d")
        ? 86_400_000
        : unit.startsWith("semana")
          ? 604_800_000
          : unit.startsWith("mes")
            ? 2_592_000_000
            : 31_536_000_000;

  return new Date(now - amount * unitMs).toISOString();
}

/**
 * Indica si el listado tiene página siguiente.
 *
 * Computrabajo no usa enlaces de paginación: el «Siguiente» es un `span` con
 * `data-path` que activa JavaScript, y en la última página desaparece. Por eso
 * no sirve buscar `.pagination` ni `rel="next"`.
 */
export function hasComputrabajoNextPage(html: string): boolean {
  const $ = cheerio.load(html);
  return $('span[title="Siguiente"][data-path]').length > 0;
}

/**
 * Parsea el listado de Computrabajo.
 *
 * Se separa del scraper para poder testearlo con HTML real: en la web actual
 * cada oferta es un `article.box_offer` con el puesto en `h2 a`, la empresa y
 * la ubicación en `p.fs16.fc_base` y la fecha en `p.fs13.fc_aux`. Los selectores
 * antiguos confundían la fecha con la ubicación.
 */
export function parseComputrabajoHtml(
  html: string,
  page: number = 0,
  baseUrl: string = "https://co.computrabajo.com",
): ScrapedJob[] {
  const $ = cheerio.load(html);
  const jobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();

  $("article.box_offer, .box_offer").each((index, element) => {
    try {
      const card = $(element);

      const linkEl = card.find("h2 a, h3 a, .offer-title a").first();
      const title = cleanText(linkEl.text());
      const href = linkEl.attr("href");
      if (!title || !href) return;

      const url = href.startsWith("http")
        ? href.split("#")[0]!
        : `${baseUrl}${href.split("#")[0]!}`;
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);

      // La empresa va en un párrafo `dFlex` que puede incluir la puntuación del
      // portal y el enlace al perfil; la ubicación, en el párrafo siguiente.
      // Se evita `span.mr10` suelto porque el bloque de puntuación también lo usa.
      const paragraphs = card.find("p.fs16.fc_base");
      const companyParagraph =
        paragraphs.filter(".dFlex").first().length > 0
          ? paragraphs.filter(".dFlex").first()
          : paragraphs.first();
      const company =
        cleanText(companyParagraph.find("a[offer-grid-article-company-url]").first().text()) ||
        cleanText(companyParagraph.find("a").first().text()) ||
        cleanText(companyParagraph.text());

      const locationParagraph = paragraphs
        .filter((_, node) => node !== companyParagraph.get(0))
        .first();
      const location =
        cleanText(locationParagraph.find("span.mr10").first().text()) ||
        cleanText(locationParagraph.text());

      const { salary, currency } = normalizeSalary(card.find("div.fs13").text());
      const postedAt = parseComputrabajoDate(card.find("p.fs13.fc_aux").first().text());

      // El portal etiqueta como «Presencial y remoto» las ofertas mixtas. La
      // detección genérica lo leería como presencial, así que se resuelve aquí.
      const modalityText = cleanText(card.find("div.fs13").text());
      const workMode = /presencial\s+y\s+remot/i.test(modalityText)
        ? ({ workMode: "hybrid", source: "portal", confidence: "high" } as const)
        : (detectWorkModeFromText(`${title} ${location}`) ??
          detectWorkModeFromText(card.text(), { requireExplicit: true }));

      jobs.push({
        jobTitle: title,
        company: company || "Sin empresa",
        url,
        source: "computrabajo",
        location: location || undefined,
        workMode: workMode?.workMode,
        workModeSource: workMode?.source ?? "unknown",
        workModeConfidence: workMode?.confidence ?? "low",
        salary,
        currency,
        postedAt,
        confidence: location ? "high" : "medium",
        pageNumber: page,
        positionInPage: index,
      });
    } catch {
      // Ignorar tarjetas con datos incompletos.
    }
  });

  return jobs;
}
