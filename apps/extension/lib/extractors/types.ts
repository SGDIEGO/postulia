import type { Source, WorkMode } from "@postulia/shared";

export interface ExtractedJob {
  jobTitle: string | null;
  company: string | null;
  url: string;
  source: Source;
  location: string | null;
  workMode: WorkMode | null;
  salary: string | null;
  currency: string | null;
  contractType: string | null;
  description: string | null;
  postedAt: string | null;
}

export interface ExtractedJobResult extends ExtractedJob {
  confidence: "high" | "medium" | "low";
  missing: string[];
  extractor: string;
}

export interface Extractor {
  name: string;
  /** Indica si el extractor aplica y si la página es el detalle de una oferta. */
  matches: (url: URL) => boolean;
  extract: (doc: Document, url: URL) => Partial<ExtractedJob>;
}

export function cleanText(value: string | null | undefined, maxLength = 400): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function firstText(doc: Document, selectors: string[], maxLength = 400): string | null {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const text = cleanText(element?.textContent, maxLength);
    if (text) return text;
  }
  return null;
}

export function metaContent(doc: Document, names: string[]): string | null {
  for (const name of names) {
    const element =
      doc.querySelector(`meta[property="${name}"]`) ?? doc.querySelector(`meta[name="${name}"]`);
    const text = cleanText(element?.getAttribute("content"));
    if (text) return text;
  }
  return null;
}

/** Minúsculas y sin tildes, para comparar etiquetas en español e inglés. */
function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/_/g, " ");
}

export function detectWorkMode(text: string | null | undefined): WorkMode | null {
  if (!text) return null;
  const value = normalizeLabel(text);
  if (value.includes("remot") || value.includes("teletrabajo") || value.includes("home office")) {
    return "remote";
  }
  if (value.includes("hibrid")) return "hybrid";
  if (value.includes("presencial") || value.includes("onsite") || value.includes("on-site")) {
    return "onsite";
  }
  return null;
}

export function detectContractType(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = normalizeLabel(text);
  if (value.includes("tiempo completo") || value.includes("full time")) return "full_time";
  if (value.includes("medio tiempo") || value.includes("part time")) return "part_time";
  if (value.includes("freelance")) return "freelance";
  if (value.includes("pasant") || value.includes("intern")) return "internship";
  if (value.includes("temporal") || value.includes("temporary")) return "temporary";
  if (value.includes("contrato") || value.includes("contract")) return "contract";
  return null;
}

/** Combina resultados: el primero que traiga un valor no nulo gana. */
export function mergeExtractions(parts: Partial<ExtractedJob>[], base: ExtractedJob): ExtractedJob {
  const merged: ExtractedJob = { ...base };
  for (const part of parts) {
    for (const [key, value] of Object.entries(part) as [keyof ExtractedJob, unknown][]) {
      if (value === null || value === undefined) continue;
      const current = merged[key];
      if (current === null || current === undefined || current === "") {
        // @ts-expect-error asignación dinámica homogénea
        merged[key] = value;
      }
    }
  }
  return merged;
}

export function stripHtml(html: string | null | undefined, maxLength = 4000): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

export function canonicalJobUrl(url: URL): string {
  const clone = new URL(url.toString());
  clone.hash = "";
  return clone.toString();
}
