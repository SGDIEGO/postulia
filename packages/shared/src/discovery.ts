import type { Source, WorkMode } from "./application.js";

/** Filtros de búsqueda mínimos v1. */
export interface SearchFilters {
  location?: string;
  workMode?: WorkMode;
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
  workMode?: WorkMode;
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
}
