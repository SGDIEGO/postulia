import type { SearchFilters } from "@postulia/shared";
import { buildPortalLocation, foldLocation, resolveCountry } from "./location.js";

const DEFAULT_COMPUTRABAJO_HOST = "co.computrabajo.com";

/** Convierte texto libre en el slug que usa Computrabajo en sus rutas. */
export function slugify(value: string): string {
  return foldLocation(value).replace(/\s+/g, "-");
}

/**
 * Ubicación para la ruta de Computrabajo.
 *
 * El portal usa `/trabajo-de-{puesto}-en-{ciudad}`. Se toma la ciudad (no el
 * país) cuando el usuario la indicó; si solo indicó el país, se usa su nombre.
 */
export function buildComputrabajoLocationSlug(location?: string): string | undefined {
  const portalLocation = buildPortalLocation(location);
  if (!portalLocation) return undefined;

  const country = resolveCountry(location);
  if (!country) return slugify(portalLocation);

  const parts = portalLocation
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => foldLocation(part) !== foldLocation(country.nameEn));

  const cityPart =
    parts.find((part) =>
      country.cities.some((city) => foldLocation(city) === foldLocation(part)),
    ) ??
    parts[0] ??
    country.nameEn;

  return slugify(cityPart) || slugify(country.nameEn);
}

/**
 * Construye la URL de búsqueda de Computrabajo.
 *
 * `page` es 0-based (como en el resto de scrapers); el portal pagina desde 1.
 * Computrabajo es nacional: `co.computrabajo.com` solo devuelve ofertas de
 * Colombia, así que el dominio depende del país de la ubicación. Devuelve
 * `undefined` cuando el país no tiene portal (España).
 */
export function buildComputrabajoSearchUrl(
  query: string,
  filters: SearchFilters,
  page: number,
): string | undefined {
  const country = resolveCountry(filters.location);
  const host = country ? country.computrabajoHost : DEFAULT_COMPUTRABAJO_HOST;
  if (!host) return undefined;

  const pageNumber = Math.max(1, page + 1);
  const querySlug = slugify(query) || "empleo";
  const locationSlug = buildComputrabajoLocationSlug(filters.location);

  if (locationSlug) {
    return `https://${host}/trabajo-de-${querySlug}-en-${locationSlug}?p=${pageNumber}`;
  }

  return `https://${host}/ofertas-de-trabajo/?q=${encodeURIComponent(query)}&p=${pageNumber}`;
}
