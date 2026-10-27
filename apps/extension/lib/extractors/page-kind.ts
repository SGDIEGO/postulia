import type { Source } from "@postulia/shared";
import { extractComputrabajoListingCard } from "./computrabajo";
import { hasJobPostingJsonLd } from "./jsonld";

/**
 * Tipo de página que está viendo el usuario.
 *
 * - `job`: la ficha de una oferta concreta.
 * - `listing`: un listado o buscador de ofertas (no se puede guardar).
 * - `unknown`: una página que no se reconoce como ninguno de los dos casos.
 */
export type PageKind = "job" | "listing" | "unknown";

export interface PageClassification {
  kind: PageKind;
  site: Source;
  /** Explicación breve, en español, para mostrar en la interfaz. */
  reason: string;
  /** La página declara schema.org/JobPosting en JSON-LD. */
  hasJobPosting: boolean;
}

const JOB_REASON = "Es la ficha de una oferta.";
const LISTING_REASON =
  "Es un listado de ofertas, no una oferta concreta. Abre una oferta para guardarla.";
const UNKNOWN_REASON = "La página no parece la ficha de una oferta.";

function siteFor(hostname: string): Source {
  if (/(^|\.)linkedin\.com$/i.test(hostname)) return "linkedin";
  if (/(^|\.)computrabajo\.[a-z.]+$/i.test(hostname)) return "computrabajo";
  if (/(^|\.)indeed\.[a-z.]+$/i.test(hostname)) return "indeed";
  if (/(^|\.)bumeran\.[a-z.]+$/i.test(hostname)) return "bumeran";
  if (/(^|\.)getonbrd\.[a-z.]+$/i.test(hostname)) return "getonbrd";
  if (/(^|\.)torre\.ai$/i.test(hostname)) return "torre";
  return "other";
}

function classifyComputrabajo(url: URL): PageKind {
  const path = url.pathname.toLowerCase();

  // Ficha: /ofertas-de-trabajo/oferta-de-trabajo-{slug}-{id}
  if (/\/oferta-de-trabajo(?:-|\/)/.test(path)) return "job";

  // Buscador y listados: /trabajo-de-*, /empleos-en-*, /empleos-de-*
  // y /ofertas-de-trabajo/ (sin una ficha detrás).
  if (path === "/ofertas-de-trabajo" || path === "/ofertas-de-trabajo/") return "listing";
  if (/^\/(?:trabajo-de-|empleos-en-|empleos-de-|ofertas-de-trabajo\/)/.test(path)) {
    return "listing";
  }

  return "unknown";
}

function classifyLinkedin(url: URL): PageKind {
  if (/\/jobs\/view\/\d+/.test(url.pathname)) return "job";

  const currentJobId = url.searchParams.get("currentJobId");
  if (currentJobId && /^\d+$/.test(currentJobId)) return "job";

  // Buscador, colecciones y portada de empleos.
  if (/^\/jobs(?:\/|$)/.test(url.pathname)) return "listing";

  return "unknown";
}

function classifyIndeed(url: URL): PageKind {
  if (url.searchParams.has("jk") || url.searchParams.has("vjk")) return "job";
  if (/\/viewjob/.test(url.pathname)) return "job";

  if (/^\/(?:m\/)?jobs(?:\/|$)/.test(url.pathname) || /-jobs\.html$/i.test(url.pathname)) {
    return "listing";
  }

  return "unknown";
}

/**
 * Clasifica la página según el portal y su ruta.
 *
 * Un JSON-LD `JobPosting` siempre gana: aunque la URL parezca un listado, si la
 * página declara una oferta concreta se puede capturar.
 */
export function classifyPage(url: URL, doc: Document): PageClassification {
  const site = siteFor(url.hostname);
  const hasJobPosting = hasJobPostingJsonLd(doc);

  let kind: PageKind = "unknown";
  if (site === "computrabajo") kind = classifyComputrabajo(url);
  else if (site === "linkedin") kind = classifyLinkedin(url);
  else if (site === "indeed") kind = classifyIndeed(url);

  // Un listado de Computrabajo con un ancla a una tarjeta concreta se puede
  // capturar como oferta: la tarjeta resuelve el enlace real a la ficha.
  if (kind === "listing" && site === "computrabajo") {
    if (extractComputrabajoListingCard(doc, url)) kind = "job";
  }

  if (hasJobPosting) kind = "job";

  return {
    kind,
    site,
    hasJobPosting,
    reason: kind === "job" ? JOB_REASON : kind === "listing" ? LISTING_REASON : UNKNOWN_REASON,
  };
}
