import type { SearchFilters } from "@postulia/shared";

/** País con su dominio propio en los portales que lo soportan. */
export interface CountryConfig {
  code: string;
  nameEs: string;
  nameEn: string;
  indeedHost: string;
  /** Computrabajo no tiene portal en todos los países (p. ej. España). */
  computrabajoHost?: string;
  /** Nombres, alias y gentilicios aceptados para reconocer el país. */
  aliases: string[];
  /** Ciudades principales, para reconocer el país a partir de la ciudad. */
  cities: string[];
}

/**
 * Países soportados. Los portales de empleo son nacionales: buscar «Perú»
 * contra el dominio colombiano devuelve ofertas de Colombia, así que el país
 * determina el dominio además del filtro.
 */
export const COUNTRIES: CountryConfig[] = [
  {
    code: "PE",
    nameEs: "Perú",
    nameEn: "Peru",
    indeedHost: "pe.indeed.com",
    computrabajoHost: "pe.computrabajo.com",
    aliases: ["Perú", "Peru", "República del Perú", "Republica del Peru", "Peruano", "Peruana"],
    cities: [
      "Lima",
      "Arequipa",
      "Trujillo",
      "Callao",
      "Chiclayo",
      "Piura",
      "Cusco",
      "Huancayo",
      "Iquitos",
      "Tacna",
      "Puno",
    ],
  },
  {
    code: "CO",
    nameEs: "Colombia",
    nameEn: "Colombia",
    indeedHost: "co.indeed.com",
    computrabajoHost: "co.computrabajo.com",
    aliases: ["Colombia", "Colombiano", "Colombiana"],
    cities: [
      "Bogotá",
      "Medellín",
      "Cali",
      "Barranquilla",
      "Cartagena",
      "Bucaramanga",
      "Pereira",
      "Manizales",
      "Cúcuta",
      "Ibagué",
      "Santa Marta",
      "Villavicencio",
    ],
  },
  {
    code: "MX",
    nameEs: "México",
    nameEn: "Mexico",
    indeedHost: "mx.indeed.com",
    computrabajoHost: "mx.computrabajo.com",
    aliases: ["México", "Mexico", "Mexicano", "Mexicana"],
    cities: [
      "Ciudad de México",
      "CDMX",
      "Guadalajara",
      "Monterrey",
      "Puebla",
      "Tijuana",
      "Querétaro",
      "Mérida",
      "Cancún",
      "Toluca",
    ],
  },
  {
    code: "AR",
    nameEs: "Argentina",
    nameEn: "Argentina",
    indeedHost: "ar.indeed.com",
    computrabajoHost: "ar.computrabajo.com",
    aliases: ["Argentina", "Argentino", "Argentina"],
    cities: [
      "Buenos Aires",
      "Córdoba",
      "Rosario",
      "Mendoza",
      "La Plata",
      "Mar del Plata",
      "Salta",
      "Tucumán",
      "Neuquén",
    ],
  },
  {
    code: "CL",
    nameEs: "Chile",
    nameEn: "Chile",
    indeedHost: "cl.indeed.com",
    computrabajoHost: "cl.computrabajo.com",
    aliases: ["Chile", "Chileno", "Chilena"],
    cities: [
      "Santiago",
      "Valparaíso",
      "Concepción",
      "La Serena",
      "Antofagasta",
      "Temuco",
      "Rancagua",
      "Iquique",
    ],
  },
  {
    code: "ES",
    nameEs: "España",
    nameEn: "Spain",
    indeedHost: "es.indeed.com",
    aliases: ["España", "Espana", "Spain", "Español", "Española"],
    cities: [
      "Madrid",
      "Barcelona",
      "Valencia",
      "Sevilla",
      "Zaragoza",
      "Málaga",
      "Bilbao",
      "Murcia",
      "Granada",
      "Palma",
      "Alicante",
    ],
  },
  {
    code: "UY",
    nameEs: "Uruguay",
    nameEn: "Uruguay",
    indeedHost: "uy.indeed.com",
    computrabajoHost: "uy.computrabajo.com",
    aliases: ["Uruguay", "Uruguayo", "Uruguaya"],
    cities: ["Montevideo", "Salto", "Maldonado", "Paysandú", "Rivera"],
  },
  {
    code: "EC",
    nameEs: "Ecuador",
    nameEn: "Ecuador",
    indeedHost: "ec.indeed.com",
    computrabajoHost: "ec.computrabajo.com",
    aliases: ["Ecuador", "Ecuatoriano", "Ecuatoriana"],
    cities: ["Quito", "Guayaquil", "Cuenca", "Ambato", "Manta", "Loja"],
  },
];

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "las",
  "los",
  "en",
  "y",
  "e",
  "the",
  "of",
  "republica",
  "republic",
  "estado",
  "state",
  "provincia",
  "province",
  "region",
  "distrito",
  "capital",
  "area",
  "metropolitana",
  "metropolitan",
]);

const REMOTE_WORDS = new Set([
  "remoto",
  "remota",
  "remote",
  "teletrabajo",
  "home",
  "office",
  "hibrido",
  "hibrida",
  "hybrid",
  "presencial",
  "onsite",
]);

/** Minúsculas, sin tildes y sin puntuación: base de todas las comparaciones. */
export function foldLocation(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

const COUNTRY_BY_ALIAS = new Map<string, CountryConfig>();
const COUNTRY_BY_CITY = new Map<string, CountryConfig[]>();

for (const country of COUNTRIES) {
  for (const alias of [country.nameEs, country.nameEn, ...country.aliases]) {
    const folded = foldLocation(alias);
    if (folded) COUNTRY_BY_ALIAS.set(folded, country);
  }
  for (const city of country.cities) {
    const folded = foldLocation(city);
    if (!folded) continue;
    const list = COUNTRY_BY_CITY.get(folded) ?? [];
    if (!list.includes(country)) list.push(country);
    COUNTRY_BY_CITY.set(folded, list);
  }
}

function countryAliasTokens(country: CountryConfig): Set<string> {
  const tokens = new Set<string>();
  for (const alias of [country.nameEs, country.nameEn, ...country.aliases]) {
    for (const token of foldLocation(alias).split(" ")) {
      if (token && !STOPWORDS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

const COUNTRY_TOKENS = new Map(
  COUNTRIES.map((country) => [country.code, countryAliasTokens(country)]),
);

interface SignificantTokens {
  all: string[];
  /** Tokens que no forman parte del nombre del país: la ciudad. */
  place: string[];
}

function significantTokens(folded: string, country?: CountryConfig): SignificantTokens {
  const countryTokens = country
    ? (COUNTRY_TOKENS.get(country.code) ?? new Set<string>())
    : new Set<string>();
  // Las palabras de modalidad («remoto», «híbrido»…) no son ubicación: si se
  // mezclan con el país («Remoto Colombia») no deben convertirse en ciudad.
  const all = folded
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !REMOTE_WORDS.has(token));
  return {
    all,
    place: all.filter((token) => !countryTokens.has(token)),
  };
}

/** Quita las palabras de modalidad de un texto de ubicación. */
function stripModalityWords(value: string): string {
  return value
    .split(/\s+/)
    .filter((token) => !REMOTE_WORDS.has(foldLocation(token)))
    .join(" ")
    .trim();
}

const COUNTRY_ONLY_ALIASES = new Map(
  COUNTRIES.map((country) => [
    country.code,
    new Set(
      [country.nameEs, country.nameEn, ...country.aliases].map((alias) => foldLocation(alias)),
    ),
  ]),
);

/**
 * Resuelve el país de una ubicación escrita por el usuario.
 * Priora el nombre del país; si no aparece, lo deduce de una ciudad única.
 */
export function resolveCountry(location?: string | null): CountryConfig | undefined {
  const folded = foldLocation(location);
  if (!folded) return undefined;

  const direct = COUNTRY_BY_ALIAS.get(folded);
  if (direct) return direct;

  for (const country of COUNTRIES) {
    if (COUNTRY_ONLY_ALIASES.get(country.code)?.has(folded)) return country;
    for (const alias of [country.nameEs, country.nameEn, ...country.aliases]) {
      if (containsPhrase(folded, foldLocation(alias))) return country;
    }
  }

  for (const [city, countries] of COUNTRY_BY_CITY) {
    if (!containsPhrase(folded, city)) continue;
    // Una ciudad compartida (p. ej. Córdoba en Argentina y España) no basta
    // para decidir el país.
    if (countries.length === 1) return countries[0];
    return undefined;
  }

  return undefined;
}

/** Indica si la ubicación es solo el país (sin ciudad). */
export function isCountryOnly(location?: string | null): boolean {
  const country = resolveCountry(location);
  if (!country) return false;

  const folded = foldLocation(location);
  const { all, place } = significantTokens(folded, country);
  return all.length > 0 && place.length === 0;
}

/** Indica si el texto no es una ubicación sino una modalidad. */
export function isRemoteOnly(location?: string | null): boolean {
  const tokens = foldLocation(location)
    .split(" ")
    .filter((token) => !STOPWORDS.has(token));
  return tokens.length > 0 && tokens.every((token) => REMOTE_WORDS.has(token));
}

/** Indica si el filtro de ubicación debe aplicarse de verdad. */
export function isLocationFilterActive(location?: string | null): boolean {
  return Boolean(location?.trim()) && !isRemoteOnly(location);
}

/**
 * Ubicación que entienden los portales.
 *
 * LinkedIn necesita el país en inglés (`Peru`), pero no reconoce el país en
 * español: enviar `Perú` devuelve ofertas de Estados Unidos. Las ciudades sí
 * funcionan en español, así que se conserva la ciudad tal cual y se le añade el
 * país en inglés.
 */
export function buildPortalLocation(location?: string | null): string | undefined {
  const trimmed = location?.trim();
  if (!trimmed) return undefined;

  const folded = foldLocation(trimmed);
  if (!folded || isRemoteOnly(folded)) return undefined;

  const country = resolveCountry(trimmed);
  if (!country) return stripModalityWords(trimmed) || undefined;

  if (isCountryOnly(trimmed)) return country.nameEn;

  // Se quitan los tramos que solo repiten el país o la modalidad («Remoto») y
  // se añade el nombre en inglés, que es el único que LinkedIn geocodifica.
  const parts = trimmed
    .split(",")
    .map((part) => stripModalityWords(part.trim()))
    .filter(Boolean);
  const kept = parts.filter((part) => !isCountryOnly(part));
  const place = (kept.length > 0 ? kept : parts).join(", ");

  return place ? `${place}, ${country.nameEn}` : country.nameEn;
}

function mentionsCountry(haystack: string, country: CountryConfig): boolean {
  return [country.nameEs, country.nameEn, ...country.aliases].some((alias) =>
    containsPhrase(haystack, foldLocation(alias)),
  );
}

function mentionsCity(haystack: string, country: CountryConfig): boolean {
  return country.cities.some((city) => containsPhrase(haystack, foldLocation(city)));
}

/**
 * Comprueba si la ubicación de una oferta entra en el filtro pedido.
 *
 * - Las tildes y mayúsculas no importan.
 * - Un filtro de país acepta sus ciudades (`Perú` ← `Lima, Perú`) y cualquier
 *   oferta publicada en el portal de ese país (`country`), aunque la ciudad no
 *   esté en la lista (p. ej. `Huanuco, Huanuco` en `pe.computrabajo.com`).
 * - Un filtro de ciudad exige esa ciudad, no otra del mismo país.
 * - Una oferta sin ubicación ni país conocido devuelve `false`: el servicio
 *   decide si la oculta o la incluye según `includeUnknownLocation`.
 */
export function matchesLocationFilter(
  jobLocation: string | undefined,
  filter: string,
  jobCountry?: string,
): boolean {
  const foldedFilter = foldLocation(filter);
  if (!foldedFilter) return true;
  if (isRemoteOnly(foldedFilter)) return true;

  const country = resolveCountry(filter);
  if (!country) {
    const foldedJob = foldLocation(jobLocation);
    if (!foldedJob) return false;
    const { all } = significantTokens(foldedFilter);
    return all.every((token) => containsPhrase(foldedJob, token));
  }

  // Si la oferta nombra otro país, no vale aunque el portal sea del buscado.
  const countryFromText = resolveCountry(jobLocation);
  if (countryFromText && countryFromText.code !== country.code) return false;

  const foldedJob = foldLocation(jobLocation);
  const { place } = significantTokens(foldedFilter, country);

  // Filtro de país: basta con que el portal sea nacional o con una ciudad suya.
  if (place.length === 0) {
    if (jobCountry?.toUpperCase() === country.code) return true;
    return (
      Boolean(foldedJob) &&
      (mentionsCountry(foldedJob, country) || mentionsCity(foldedJob, country))
    );
  }

  // Filtro con ciudad: exigir la ciudad, aunque el país no aparezca.
  if (!foldedJob) return false;
  return place.every((token) => containsPhrase(foldedJob, token));
}

/** Filtro de ubicación del usuario, o `undefined` si no aplica. */
export function activeLocationFilter(filters: Pick<SearchFilters, "location">): string | undefined {
  return isLocationFilterActive(filters.location) ? filters.location?.trim() : undefined;
}
