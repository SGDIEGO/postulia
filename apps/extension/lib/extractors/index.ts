import { normalizeJobUrl, type Source } from "@postulia/shared";
import { computrabajoExtractor } from "./computrabajo";
import { genericExtractor } from "./generic";
import { indeedExtractor } from "./indeed";
import { extractFromJsonLd } from "./jsonld";
import { linkedinExtractor } from "./linkedin";
import {
  canonicalJobUrl,
  mergeExtractions,
  type ExtractedJob,
  type ExtractedJobResult,
  type Extractor,
} from "./types";

export type { ExtractedJob, ExtractedJobResult, Extractor } from "./types";

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

/**
 * Extrae los datos de la oferta abierta combinando JSON-LD, el adaptador del
 * portal y heurísticas genéricas. Devuelve `null` cuando la página no parece
 * el detalle de una oferta.
 */
export function extractJob(url: string, doc: Document): ExtractedJobResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const adapter = findAdapter(parsed);
  const fromJsonLd = extractFromJsonLd(doc) ?? {};
  const fromAdapter = adapter ? adapter.extract(doc, parsed) : {};
  const fromGeneric = genericExtractor.extract(doc, parsed);

  const looksLikeJobPosting = Boolean(fromJsonLd.jobTitle) || Boolean(adapter);
  const genericLooksValid = Boolean(fromGeneric.jobTitle && fromGeneric.company);
  if (!looksLikeJobPosting && !genericLooksValid) return null;

  const base: ExtractedJob = {
    jobTitle: null,
    company: null,
    url: normalizeJobUrl(url),
    source: adapter?.source ?? "other",
    location: null,
    workMode: null,
    salary: null,
    currency: null,
    contractType: null,
    description: null,
    postedAt: null,
  };

  const merged = mergeExtractions([fromJsonLd, fromAdapter, fromGeneric], base);

  // La URL canónica del adaptador (por ejemplo con el id limpio) tiene prioridad.
  if (fromAdapter.url) merged.url = canonicalJobUrl(new URL(fromAdapter.url));
  merged.url = normalizeJobUrl(merged.url);

  const missing = (["jobTitle", "company"] as const).filter((field) => !merged[field]);

  let confidence: ExtractedJobResult["confidence"] = "low";
  if (missing.length === 0) {
    confidence = fromJsonLd.jobTitle || adapter ? "high" : "medium";
  } else if (merged.jobTitle) {
    confidence = "medium";
  }

  return {
    ...merged,
    confidence,
    missing: [...missing],
    extractor: adapter?.name ?? (fromJsonLd.jobTitle ? "jsonld" : "generic"),
  };
}
