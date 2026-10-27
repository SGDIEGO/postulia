import { normalizeJobUrl, type Source } from "@postulia/shared";
import { computrabajoExtractor, extractComputrabajoListingCard } from "./computrabajo";
import { genericExtractor } from "./generic";
import { indeedExtractor } from "./indeed";
import { extractFromJsonLd } from "./jsonld";
import { linkedinExtractor } from "./linkedin";
import { classifyPage, type PageClassification } from "./page-kind";
import {
  canonicalJobUrl,
  mergeExtractions,
  type ExtractedJob,
  type ExtractedJobResult,
  type Extractor,
} from "./types";

export type { ExtractedJob, ExtractedJobResult, Extractor } from "./types";
export type { PageClassification, PageKind } from "./page-kind";
export { classifyPage } from "./page-kind";

/** Respuesta completa del content script para el panel lateral. */
export interface ExtractPageResult {
  job: ExtractedJobResult | null;
  classification: PageClassification;
  pageUrl: string;
}

/** Distingue el formato nuevo del que devolvían versiones anteriores. */
export function isExtractPageResult(value: unknown): value is ExtractPageResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return "job" in record && "classification" in record;
}

interface SiteAdapter extends Extractor {
  source: Source;
}

const SITE_ADAPTERS: SiteAdapter[] = [
  { ...linkedinExtractor, source: "linkedin" },
  { ...computrabajoExtractor, source: "computrabajo" },
  { ...indeedExtractor, source: "indeed" },
];

export function findAdapter(url: URL): SiteAdapter | null {
  return SITE_ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}

function extractJobFromPage(
  parsed: URL,
  doc: Document,
  classification: PageClassification,
): ExtractedJobResult | null {
  const adapter = findAdapter(parsed);

  // Un listado de Computrabajo puede tener un ancla (`#ID` o `#lc=...`) a una
  // tarjeta concreta: se resuelve su enlace real a la ficha. Sin ancla válida,
  // el listado no es una oferta.
  const listingCard =
    classification.site === "computrabajo" && !adapter
      ? extractComputrabajoListingCard(doc, parsed)
      : null;

  if (classification.kind === "listing" && !listingCard) return null;
  if (
    classification.kind !== "job" &&
    !listingCard &&
    SITE_ADAPTERS.some((item) => item.source === classification.site)
  ) {
    // El portal tiene adaptador propio pero la ruta no es una ficha: no se cae
    // al extractor genérico, que inventaría una oferta con el título del sitio.
    return null;
  }

  const url = parsed.toString();
  const fromJsonLd = extractFromJsonLd(doc) ?? {};
  const fromListing = listingCard ?? {};
  const fromAdapter = adapter ? adapter.extract(doc, parsed) : {};
  const fromGeneric = genericExtractor.extract(doc, parsed);

  const looksLikeJobPosting = Boolean(fromJsonLd.jobTitle) || Boolean(fromListing.jobTitle);
  const genericLooksValid = Boolean(fromGeneric.jobTitle && fromGeneric.company);
  if (!looksLikeJobPosting && !adapter && !genericLooksValid) return null;

  const base: ExtractedJob = {
    jobTitle: null,
    company: null,
    url: normalizeJobUrl(url),
    source: adapter?.source ?? (fromListing.jobTitle ? classification.site : "other"),
    location: null,
    workMode: null,
    salary: null,
    currency: null,
    contractType: null,
    description: null,
    postedAt: null,
  };

  const merged = mergeExtractions([fromJsonLd, fromListing, fromAdapter, fromGeneric], base);

  // El portal es la fuente más fiable para la modalidad: su etiqueta gana
  // sobre la inferencia del JSON-LD o del texto genérico.
  merged.workMode =
    fromAdapter.workMode ??
    fromListing.workMode ??
    fromJsonLd.workMode ??
    fromGeneric.workMode ??
    null;

  // La URL canónica del adaptador o de la tarjeta tiene prioridad sobre la URL
  // de la pestaña (que puede ser la del listado con ancla).
  const canonicalUrl = fromAdapter.url ?? fromListing.url;
  if (canonicalUrl) merged.url = canonicalJobUrl(new URL(canonicalUrl));
  merged.url = normalizeJobUrl(merged.url);

  const missing = (["jobTitle", "company"] as const).filter((field) => !merged[field]);

  let confidence: ExtractedJobResult["confidence"] = "low";
  if (missing.length === 0) {
    confidence = fromListing.jobTitle
      ? "medium"
      : fromJsonLd.jobTitle || adapter
        ? "high"
        : "medium";
  } else if (merged.jobTitle) {
    confidence = "medium";
  }

  return {
    ...merged,
    confidence,
    missing: [...missing],
    extractor:
      adapter?.name ??
      (fromListing.jobTitle ? "computrabajo-listing" : fromJsonLd.jobTitle ? "jsonld" : "generic"),
  };
}

/**
 * Extrae los datos de la oferta abierta combinando JSON-LD, el adaptador del
 * portal y heurísticas genéricas. Devuelve `null` cuando la página no parece
 * el detalle de una oferta (por ejemplo, un listado de resultados).
 */
export function extractJob(url: string, doc: Document): ExtractedJobResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  return extractJobFromPage(parsed, doc, classifyPage(parsed, doc));
}

/**
 * Extrae la oferta y devuelve también la clasificación de la página, para que
 * el panel pueda explicar por qué no se puede capturar.
 */
export function extractPage(url: string, doc: Document): ExtractPageResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      job: null,
      classification: {
        kind: "unknown",
        site: "other",
        reason: "La URL de esta pestaña no es válida.",
        hasJobPosting: false,
      },
      pageUrl: url,
    };
  }

  const classification = classifyPage(parsed, doc);
  return {
    job: extractJobFromPage(parsed, doc, classification),
    classification,
    pageUrl: url,
  };
}
