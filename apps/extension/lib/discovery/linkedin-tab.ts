import { detectWorkModeFromText, parseWorkModeLabel, type WorkMode } from "@postulia/shared";
import type { ScrapedJob } from "./scrapers.js";

/** Tarjeta leída de la pestaña, antes de clasificar su modalidad. */
export interface LinkedInInspectionJob extends ScrapedJob {
  /** Textos de la tarjeta que pueden contener la modalidad. */
  workplaceTexts?: string[];
}

export interface LinkedInPageInspection {
  jobs: LinkedInInspectionJob[];
  cardCount: number;
  url: string;
  title: string;
  blocked: boolean;
  /** La página se cargó con la sesión de LinkedIn del usuario. */
  authenticated: boolean;
  /** La página tiene el contenedor del listado de resultados. */
  listContainerFound: boolean;
  /** LinkedIn mostró explícitamente que no hay resultados. */
  emptyState: boolean;
}

/**
 * Clasifica las tarjetas leídas de la pestaña. La función que corre dentro de
 * LinkedIn no puede importar código del módulo, así que solo devuelve textos y
 * aquí se aplica la detección compartida.
 *
 * `portalWorkMode` solo debe pasarse cuando consta que LinkedIn aplicó `f_WT`:
 * en ese caso las tarjetas que no repiten la modalidad se marcan con la pedida
 * (confianza media). Sin esa garantía se dejan como desconocidas.
 */
export function normalizeInspectionJobs(
  jobs: LinkedInInspectionJob[],
  portalWorkMode?: WorkMode,
): ScrapedJob[] {
  return jobs.map(({ workplaceTexts, ...job }) => {
    let detection;
    for (const text of workplaceTexts ?? []) {
      detection = parseWorkModeLabel(text);
      if (detection) break;
    }
    detection ??= detectWorkModeFromText(`${job.jobTitle} ${job.location ?? ""}`);

    if (detection) {
      return {
        ...job,
        workMode: detection.workMode,
        workModeSource: detection.source,
        workModeConfidence: detection.confidence,
      };
    }

    if (portalWorkMode) {
      return {
        ...job,
        workMode: portalWorkMode,
        workModeSource: "portal",
        workModeConfidence: "medium",
      };
    }

    return {
      ...job,
      workMode: undefined,
      workModeSource: "unknown",
      workModeConfidence: "low",
    };
  });
}

/**
 * Función que se ejecuta en el contexto de la página de LinkedIn.
 *
 * Debe ser autocontenida: `scripting.executeScript` la serializa y la ejecuta
 * en la pestaña, por lo que no puede referenciar variables del módulo.
 *
 * Cubre tanto la página antigua (`/jobs/search/`) como la actual
 * (`/jobs/search-results/`), donde las tarjetas son `li[data-occludable-job-id]`
 * y ya no usan `.job-search-card` ni `data-job-id` en el elemento de la lista.
 */
export function inspectLinkedInPage(page: number): LinkedInPageInspection {
  const jobs: LinkedInInspectionJob[] = [];
  const seenUrls = new Set<string>();

  const listCards = document.querySelectorAll<HTMLElement>("li[data-occludable-job-id]");
  const cards: HTMLElement[] =
    listCards.length > 0
      ? Array.from(listCards)
      : Array.from(
          document.querySelectorAll<HTMLElement>(
            "li.jobs-search-results__list-item, li.scaffold-layout__list-item, .job-card-container, .job-search-card, [data-entity-urn*='jobPosting'], [data-job-id]",
          ),
        );

  cards.forEach((card, index) => {
    try {
      const titleEl = card.querySelector<HTMLElement>(
        "a.job-card-container__link strong, .job-card-list__title--link, .job-card-list__title, .job-search-card__title, .base-search-card__title, h3 a, [data-job-title]",
      );
      const title = (titleEl?.textContent ?? titleEl?.getAttribute("aria-label") ?? "").trim();

      const companyEl = card.querySelector<HTMLElement>(
        ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name, .job-search-card__subtitle a, .base-search-card__subtitle, h4 a, [data-company-name]",
      );
      const company = (companyEl?.textContent ?? "").trim();

      const linkEl = card.querySelector<HTMLAnchorElement>(
        'a[href*="/jobs/view/"], a.job-card-container__link, a.base-card__full-link, h3 a',
      );
      const href = linkEl?.getAttribute("href") ?? "";
      const hrefId = href.match(/\/jobs\/view\/(?:.*-)?(\d+)/)?.[1];
      const jobId =
        card.getAttribute("data-occludable-job-id") ??
        card.getAttribute("data-job-id") ??
        hrefId ??
        card.querySelector("[data-job-id]")?.getAttribute("data-job-id") ??
        undefined;
      const url = jobId
        ? `https://www.linkedin.com/jobs/view/${jobId}/`
        : (href.split("?")[0] ?? "");

      // Las tarjetas nuevas muestran ubicación y modalidad como elementos de
      // una misma lista de metadatos; se separan por su contenido.
      const metadata = Array.from(
        card.querySelectorAll<HTMLElement>(
          ".job-card-container__metadata-item, .job-card-container__metadata-wrapper li, .job-search-card__location, .job-result-card__location, [data-job-location]",
        ),
      )
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean);

      const location =
        metadata.find(
          (text) => !/^(hace|hace \d|ayer|today|just now|\d+\s*(h|d|sem|min))/i.test(text),
        ) ?? undefined;

      const workplaceTexts = Array.from(
        card.querySelectorAll<HTMLElement>(
          '[class*="workplace-type"], [data-work-type], .job-search-card__work-type, .job-result-card__work-type',
        ),
      )
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .concat(metadata);

      const dateEl = card.querySelector<HTMLTimeElement>(
        "time[datetime], time.job-card-container__listdate, .job-search-card__listdate",
      );
      const postedAt = dateEl?.getAttribute("datetime") ?? undefined;

      if (!title || !company || !url || seenUrls.has(url)) return;

      seenUrls.add(url);
      jobs.push({
        jobTitle: title,
        company,
        url,
        source: "linkedin",
        location,
        workplaceTexts,
        postedAt,
        confidence: location ? "high" : "medium",
        pageNumber: page,
        positionInPage: index,
      });
    } catch {
      // Ignorar tarjetas individuales con datos incompletos.
    }
  });

  const bodyText = (document.body?.innerText ?? "").slice(0, 4_000);
  const blocked =
    /\/(authwall|checkpoint|login)/.test(window.location.href) ||
    (/sign in|iniciar sesión|join linkedin|unirse a linkedin/i.test(bodyText) && jobs.length === 0);
  const authenticated = Boolean(
    document.querySelector(
      'a[href*="/mynetwork"], a[href*="/notifications"], .global-nav__me, [data-test-id="nav-settings__dropdown-trigger"], .global-nav__primary-link-me-menu-trigger',
    ),
  );
  const listContainerFound = Boolean(
    document.querySelector(
      ".scaffold-layout__list, .jobs-search-results-list, [class*='search-results-list'], [class*='jobs-search-results']",
    ),
  );
  const emptyState =
    Boolean(
      document.querySelector(
        '[class*="no-results"], .jobs-search-no-results, [data-test-id*="no-results"]',
      ),
    ) ||
    /no matching jobs|no se encontraron (ofertas|resultados|empleos)|no hay ofertas/i.test(
      bodyText,
    );

  return {
    jobs,
    cardCount: cards.length,
    url: window.location.href,
    title: document.title,
    blocked,
    authenticated,
    listContainerFound,
    emptyState,
  };
}

/**
 * Empuja el listado para que LinkedIn pinte las tarjetas virtualizadas. En una
 * pestaña en segundo plano el render perezoso a veces no se dispara solo.
 *
 * Debe ser autocontenida, igual que `inspectLinkedInPage`.
 */
export function nudgeLinkedInList(): void {
  const list = document.querySelector<HTMLElement>(
    ".scaffold-layout__list, .jobs-search-results-list, .jobs-search-results__list, [class*='search-results-list']",
  );
  if (list) {
    list.scrollTop = list.scrollTop + 800;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  window.scrollTo(0, document.body.scrollHeight);
  window.scrollTo(0, 0);
}
