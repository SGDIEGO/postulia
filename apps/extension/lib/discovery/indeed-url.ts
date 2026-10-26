import type { SearchFilters, WorkMode } from "@postulia/shared";
import { resolveCountry } from "./location.js";

const DEFAULT_INDEED_HOST = "co.indeed.com";

/**
 * Filtros nativos de modalidad de Indeed. «Presencial» no tiene filtro propio
 * en el portal, así que se resuelve con el filtro estricto del servicio.
 */
const INDEED_WORK_MODE_FILTER: Partial<Record<WorkMode, string>> = {
  remote: "0kf:attr(DSQF7);",
  hybrid: "0kf:attr(PAXZC);",
};

/**
 * Construye la URL de búsqueda de Indeed aplicando los filtros disponibles.
 *
 * Indeed es nacional: `co.indeed.com` con `l=Perú` devuelve ofertas de Colombia.
 * Por eso el dominio se elige a partir del país de la ubicación.
 */
export function buildIndeedSearchUrl(query: string, filters: SearchFilters, page: number): string {
  const country = resolveCountry(filters.location);
  const host = country?.indeedHost ?? DEFAULT_INDEED_HOST;

  const days =
    filters.postedWithinDays && filters.postedWithinDays > 0 ? filters.postedWithinDays : 7;
  const params = new URLSearchParams({
    q: query,
    l: filters.location?.trim() ?? "",
    start: String(page * 10),
    sort: "date",
    fromage: String(days),
  });
  const workModeFilter = filters.workMode ? INDEED_WORK_MODE_FILTER[filters.workMode] : undefined;
  if (workModeFilter) params.set("sc", workModeFilter);

  return `https://${host}/jobs?${params.toString()}`;
}
