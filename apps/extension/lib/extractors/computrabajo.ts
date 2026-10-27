import type { WorkMode } from "@postulia/shared";
import {
  cleanText,
  detectContractType,
  detectWorkMode,
  firstText,
  type ExtractedJob,
  type Extractor,
} from "./types";

const TITLE_SELECTORS = ["h1.fs24", "h1[class*='fs24']", ".box_detail h1", "h2.fs24", "h1"];

const COMPANY_SELECTORS = [
  ".box_detail a[href*='/empresas/']",
  ".box_company a",
  "[class*='company'] a[href*='/empresas/']",
  "[class*='company']",
];

const LOCATION_SELECTORS = [".box_detail p.fs13", "[class*='location']", "p[class*='fs13']"];

const SALARY_SELECTORS = ["[class*='salary']", "[class*='salario']", ".box_detail .fs16"];

/** El id de oferta de Computrabajo es un hexadecimal de 32 caracteres. */
const LISTING_ID_PATTERN = /^[A-Z0-9]{16,64}$/i;

/** Primer texto con aspecto de salario («S/ 2.000», «USD 1,500», …). */
const SALARY_PATTERN = /^(s\/|usd|eur|\$|€|£)\s*[\d.,]/i;

/** Modalidad a partir de la tarjeta: «Presencial y remoto» es híbrida. */
function detectCardWorkMode(card: Element): WorkMode | null {
  const text = cleanText(card.textContent, 1000);
  if (!text) return null;

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const remote = /\b(remot[oa]|remote|teletrabajo|home[ -]?office)\b/.test(normalized);
  const onsite = /\b(presencial|on[ -]?site)\b/.test(normalized);

  if (remote && onsite) return "hybrid";
  return detectWorkMode(text);
}

/**
 * Extrae la oferta que el usuario tiene anclada dentro de un listado de
 * Computrabajo. La URL del listado puede traer `#ID` (ancla de la tarjeta) o
 * `#lc=...`; en ambos casos se resuelve la tarjeta y se usa su enlace real a la
 * ficha como URL canónica.
 */
export function extractComputrabajoListingCard(
  doc: Document,
  url: URL,
): Partial<ExtractedJob> | null {
  const hash = decodeURIComponent(url.hash.replace(/^#/, "")).trim();
  if (!hash) return null;

  const cards = [...doc.querySelectorAll("article.box_offer")];
  const card = LISTING_ID_PATTERN.test(hash)
    ? cards.find((item) => item.getAttribute("data-id") === hash || item.id === hash)
    : hash.startsWith("lc=")
      ? cards.find((item) => item.getAttribute("data-lc") === hash.slice(3))
      : undefined;

  if (!card) return null;

  const link = card.querySelector<HTMLAnchorElement>(
    "h2 a[href*='/ofertas-de-trabajo/oferta-de-trabajo-']",
  );
  const href = link?.getAttribute("href");
  if (!href) return null;

  let detailUrl: string;
  try {
    detailUrl = new URL(href, url.origin).toString();
  } catch {
    return null;
  }

  const paragraphs = [...card.querySelectorAll("p.fs16")]
    .map((element) => cleanText(element.textContent))
    .filter((text): text is string => Boolean(text));

  // El primer párrafo suele ser la empresa; después pueden venir ubicación y
  // salario. Se separan por su formato para no guardar el salario como ciudad.
  const details = paragraphs.slice(1);

  return {
    jobTitle: cleanText(link?.textContent),
    company: cleanText(card.querySelector("[offer-grid-article-company-url]")?.textContent),
    location: details.find((text) => !SALARY_PATTERN.test(text)) ?? null,
    workMode: detectCardWorkMode(card),
    salary: details.find((text) => SALARY_PATTERN.test(text)) ?? null,
    contractType: detectContractType(cleanText(card.textContent, 1000)),
    description: null,
    url: detailUrl,
  };
}

export const computrabajoExtractor: Extractor = {
  name: "computrabajo",
  matches: (url) => {
    if (!/(^|\.)computrabajo\.[a-z.]+$/i.test(url.hostname)) return false;
    return (
      /\/oferta-de-trabajo\//.test(url.pathname) || /\/ofertas-de-trabajo\/[^/]+/.test(url.pathname)
    );
  },
  extract: (doc, url) => {
    const title = firstText(doc, TITLE_SELECTORS);
    const location = firstText(doc, LOCATION_SELECTORS);
    const salaryText = firstText(doc, SALARY_SELECTORS);
    const salary =
      salaryText && /\d/.test(salaryText) && /[$€£]|s\/|usd/i.test(salaryText) ? salaryText : null;

    const description = firstText(doc, [".box_detail", "[class*='description']"], 4000);

    return {
      jobTitle: title,
      company: firstText(doc, COMPANY_SELECTORS),
      location,
      // Computrabajo suele indicar la modalidad en el título («… / remoto / …»).
      // La descripción no sirve aquí: frases como «atención remota» describen
      // las tareas, no la modalidad del puesto.
      workMode: detectWorkMode(title) ?? detectWorkMode(location),
      salary,
      contractType: detectContractType(description),
      description: description ? description.slice(0, 4000) : null,
      url: url.toString(),
    };
  },
};
