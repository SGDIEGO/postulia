import type { Source, WorkMode, WorkModeConfidence, WorkModeSource } from "./application.js";

/** Filtros de búsqueda mínimos v1. */
export interface SearchFilters {
  location?: string;
  workMode?: WorkMode;
  /**
   * Cuando se filtra por modalidad, incluir también las ofertas en las que el
   * portal no confirmó ninguna. Por defecto se ocultan: mostrarlas mezcladas
   * hace que aparezcan ofertas presenciales en búsquedas de remoto.
   */
  includeUnknownWorkMode?: boolean;
  /**
   * Cuando se filtra por ubicación, incluir también las ofertas en las que el
   * portal no indicó ninguna. Por defecto se ocultan: si el portal ignoró la
   * ubicación, sus resultados son de otro país.
   */
  includeUnknownLocation?: boolean;
  postedWithinDays?: number;
  contractType?: string;
}

/** Ofertas descubiertas mediante scraping (caché local, no sincronizan al servidor). */
export interface DiscoveredJob {
  id: string;
  source: Source;
  searchQuery: string;
  jobTitle: string;
  company: string;
  url: string;
  urlHash: string;
  location?: string;
  /**
   * País del portal que publicó la oferta (ISO 3166-1 alfa-2). Los portales son
   * nacionales, así que el dominio dice el país aunque la oferta solo indique la
   * ciudad. Sirve para no descartar ofertas de provincias que no están en la
   * lista de ciudades conocidas.
   */
  country?: string;
  workMode?: WorkMode;
  /** De dónde salió la modalidad: portal, JSON-LD, texto o desconocida. */
  workModeSource?: WorkModeSource;
  /** Confianza de la deducción de modalidad. */
  workModeConfidence?: WorkModeConfidence;
  salary?: string;
  currency?: string;
  postedAt?: string;
  scrapedAt: string;
  expiresAt: string;
  pageNumber: number;
  positionInPage: number;
  confidence: "high" | "medium" | "low";
  userAction?: "saved" | "dismissed" | "remind_later";
  reminderAt?: string;
}

/** Historial de búsquedas del usuario para sugerencias. */
export interface SearchHistory {
  id: string;
  query: string;
  source?: Source;
  filters: SearchFilters;
  executedAt: string;
  resultCount: number;
  savedAsAlert?: boolean;
}

/** Alertas de búsqueda programadas (notificaciones push). */
export interface SearchAlert {
  id: string;
  query: string;
  source?: Source;
  filters: SearchFilters;
  frequency: "daily" | "weekly";
  lastRunAt?: string;
  enabled: boolean;
  createdAt: string;
}

/** Acción del usuario sobre una oferta descubierta. */
export type DiscoveryAction = "save" | "dismiss" | "remind_later";

/** Respuesta de búsqueda paginada. */
export interface DiscoverySearchResult {
  jobs: DiscoveredJob[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** Portales que fallaron durante la búsqueda (la búsqueda sigue con el resto). */
  warnings?: string[];
  /** Ofertas descartadas por no tener modalidad confirmada. */
  hiddenUnknownWorkMode?: number;
  /** Ofertas descartadas por no indicar ubicación. */
  hiddenUnknownLocation?: number;
}

/**
 * Decide si una oferta pasa el filtro de modalidad.
 *
 * El filtro es estricto: una oferta con modalidad desconocida solo se incluye
 * si el usuario lo pide explícitamente. Así una búsqueda de «Remoto» no
 * devuelve ofertas que en el portal son presenciales.
 */
export function matchesWorkModeFilter(
  job: Pick<DiscoveredJob, "workMode">,
  filters: Pick<SearchFilters, "workMode" | "includeUnknownWorkMode">,
): boolean {
  if (!filters.workMode) return true;
  if (job.workMode === filters.workMode) return true;
  return !job.workMode && filters.includeUnknownWorkMode === true;
}
