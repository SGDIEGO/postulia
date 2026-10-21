import type { Source } from "./application.js";

/**
 * Parámetros que forman parte de la identidad de la oferta y hay que conservar
 * (por ejemplo Indeed identifica la vacante con `jk`).
 */
const KEEP_PARAMS = new Set([
  "jk",
  "vjk",
  "currentjobid",
  "jobid",
  "job_id",
  "id",
  "gh_jid",
  "jid",
]);

/** Parámetros de seguimiento/marketing que se eliminan al normalizar. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "trk",
  "trackingid",
  "refid",
  "ref",
  "ref_",
  "src",
  "from",
  "alternateChannel",
  "pos",
  "position",
  "pagenum",
  "start",
  "ebs",
  "lipi",
  "lici",
  "originalSubdomain",
  "alternateChannel",
  "applysrc",
  "recommendedFlavor",
  "savedSearchId",
  "f_TPR",
  "vjs",
  "continueUrl",
  "spa",
  "cid",
  "mid",
]);

const SOURCE_HOST_MAP: { source: Source; match: RegExp }[] = [
  { source: "linkedin", match: /(^|\.)linkedin\.com$/i },
  { source: "computrabajo", match: /(^|\.)computrabajo\.[a-z.]+$/i },
  { source: "indeed", match: /(^|\.)indeed\.[a-z.]+$/i },
  { source: "bumeran", match: /(^|\.)bumeran\.com$/i },
  { source: "getonbrd", match: /(^|\.)getonbrd\.com$/i },
  { source: "torre", match: /(^|\.)torre\.ai$/i },
];

/** Detecta el portal a partir de la URL. */
export function detectSource(rawUrl: string): Source {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return "other";
  }
  const found = SOURCE_HOST_MAP.find((entry) => entry.match.test(host));
  return found?.source ?? "other";
}

/** Dominio canónico para portales con ids de vacante compartidos entre subdominios. */
const CANONICAL_HOSTS: Partial<Record<Source, string>> = {
  linkedin: "linkedin.com",
  indeed: "indeed.com",
  getonbrd: "getonbrd.com",
  torre: "torre.ai",
};

/**
 * Normaliza la URL de una oferta para poder compararla:
 * minúsculas en el host, sin fragmentos, sin barra final y sin parámetros de
 * seguimiento (conservando los que identifican la vacante).
 */
export function normalizeJobUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.protocol = "https:";

  // Unifica subdominios de idioma/país donde los ids de vacante son globales
  // (p. ej. es.linkedin.com y www.linkedin.com apuntan a la misma oferta).
  const canonicalHost = CANONICAL_HOSTS[detectSource(parsed.toString())];
  if (canonicalHost) {
    parsed.hostname = canonicalHost;
  }

  const kept: [string, string][] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (KEEP_PARAMS.has(lower)) {
      kept.push([key, value]);
    } else if (!TRACKING_PARAMS.has(lower) && !lower.startsWith("utm_")) {
      kept.push([key, value]);
    }
  }

  kept.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = "";
  for (const [key, value] of kept) {
    parsed.searchParams.append(key, value);
  }

  let path = parsed.pathname.replace(/\/+$/, "");
  if (path === "") {
    path = "/";
  }
  parsed.pathname = path;

  return parsed.toString().replace(/\/$/, "");
}

/**
 * Huella estable de una URL de oferta, usada para detectar duplicados.
 * Usa Web Crypto (disponible en el navegador y en Node 20+).
 */
export async function hashUrl(rawUrl: string): Promise<string> {
  const normalized = normalizeJobUrl(rawUrl);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

/** `https://www.linkedin.com/jobs/view/123` → `linkedin.com` */
export function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Similitud simple entre dos textos (0 a 1) por bigramas.
 * Se usa para avisar de posibles duplicados cuando cambia la URL.
 */
export function textSimilarity(a: string, b: string): number {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const bigrams = (value: string) => {
    const set = new Set<string>();
    for (let index = 0; index < value.length - 1; index += 1) {
      set.add(value.slice(index, index + 2));
    }
    return set;
  };

  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  let shared = 0;
  for (const gram of leftSet) {
    if (rightSet.has(gram)) shared += 1;
  }
  return (2 * shared) / (leftSet.size + rightSet.size);
}
