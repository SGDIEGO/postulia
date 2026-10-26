// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { inspectLinkedInPage, normalizeInspectionJobs } from "./linkedin-tab.js";

function searchResultsCard(options: {
  id: string;
  title: string;
  company: string;
  metadata: string[];
}): string {
  return `
    <li data-occludable-job-id="${options.id}" class="scaffold-layout__list-item">
      <div class="job-card-container" data-job-id="${options.id}">
        <a class="job-card-container__link" href="/jobs/view/${options.id}/full-stack-developer-at-leverage?position=1">
          <strong>${options.title}</strong>
        </a>
        <div class="artdeco-entity-lockup__subtitle">${options.company}</div>
        <ul class="job-card-container__metadata-wrapper">
          ${options.metadata
            .map((text) => `<li class="job-card-container__metadata-item">${text}</li>`)
            .join("")}
        </ul>
      </div>
    </li>
  `;
}

function renderSearchResults(cards: string, options: { authenticated?: boolean } = {}): void {
  document.body.innerHTML = `
    ${options.authenticated === false ? "" : '<a href="/mynetwork/">Mi red</a>'}
    <div class="scaffold-layout__list">
      <ul class="scaffold-layout__list-container">${cards}</ul>
    </div>
  `;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/jobs/search-results/?keywords=junior&start=0&f_WT=2");
});

describe("inspectLinkedInPage", () => {
  it("lee las tarjetas del DOM actual de /jobs/search-results/", () => {
    renderSearchResults(
      searchResultsCard({
        id: "4481291698",
        title: "Full Stack Developer",
        company: "Leverage",
        metadata: ["Bogotá, Colombia (Remote)", "Hace 2 días"],
      }),
    );

    const inspection = inspectLinkedInPage(0);

    expect(inspection.cardCount).toBe(1);
    expect(inspection.listContainerFound).toBe(true);
    expect(inspection.authenticated).toBe(true);
    expect(inspection.jobs).toHaveLength(1);
    expect(inspection.jobs[0]).toMatchObject({
      jobTitle: "Full Stack Developer",
      company: "Leverage",
      url: "https://www.linkedin.com/jobs/view/4481291698/",
      location: "Bogotá, Colombia (Remote)",
      pageNumber: 0,
    });
    expect(inspection.jobs[0]?.workplaceTexts).toContain("Bogotá, Colombia (Remote)");
  });

  it("no toma la antigüedad como ubicación", () => {
    renderSearchResults(
      searchResultsCard({
        id: "4481291699",
        title: "Backend Developer",
        company: "Acme",
        metadata: ["Hace 2 días", "Medellín, Colombia"],
      }),
    );

    const inspection = inspectLinkedInPage(0);

    expect(inspection.jobs[0]?.location).toBe("Medellín, Colombia");
  });

  it("marca la página como no autenticada sin el menú de sesión", () => {
    renderSearchResults(
      searchResultsCard({
        id: "4481291700",
        title: "Backend Developer",
        company: "Acme",
        metadata: ["Bogotá, Colombia"],
      }),
      { authenticated: false },
    );

    expect(inspectLinkedInPage(0).authenticated).toBe(false);
  });

  it("detecta el estado vacío explícito de LinkedIn", () => {
    document.body.innerHTML = `
      <a href="/mynetwork/">Mi red</a>
      <div class="jobs-search-no-results">No matching jobs found.</div>
    `;

    const inspection = inspectLinkedInPage(0);

    expect(inspection.emptyState).toBe(true);
    expect(inspection.jobs).toHaveLength(0);
  });

  it("devuelve cero tarjetas si el DOM no es una búsqueda", () => {
    document.body.innerHTML = "<div>Otra página</div>";

    const inspection = inspectLinkedInPage(0);

    expect(inspection.cardCount).toBe(0);
    expect(inspection.jobs).toEqual([]);
  });
});

describe("normalizeInspectionJobs", () => {
  it("usa la modalidad explícita de los metadatos", () => {
    const [job] = normalizeInspectionJobs([
      {
        jobTitle: "Full Stack Developer",
        company: "Leverage",
        url: "https://www.linkedin.com/jobs/view/4481291698/",
        source: "linkedin",
        location: "Bogotá, Colombia",
        workplaceTexts: ["Híbrido"],
        confidence: "high",
        pageNumber: 0,
        positionInPage: 0,
      },
    ]);

    expect(job).toMatchObject({
      workMode: "hybrid",
      workModeSource: "portal",
      workModeConfidence: "high",
    });
  });

  it("no inventa modalidad si la tarjeta no la indica", () => {
    const [job] = normalizeInspectionJobs([
      {
        jobTitle: "Backend Developer",
        company: "Acme",
        url: "https://www.linkedin.com/jobs/view/4481291701/",
        source: "linkedin",
        location: "Bogotá, Colombia",
        confidence: "high",
        pageNumber: 0,
        positionInPage: 0,
      },
    ]);

    expect(job?.workMode).toBeUndefined();
    expect(job?.workModeSource).toBe("unknown");
  });

  it("aplica la modalidad del portal solo cuando se confirma el filtro", () => {
    const base = {
      jobTitle: "Backend Developer",
      company: "Acme",
      url: "https://www.linkedin.com/jobs/view/4481291702/",
      source: "linkedin" as const,
      location: "Bogotá, Colombia",
      confidence: "high" as const,
      pageNumber: 0,
      positionInPage: 0,
    };

    const [withFilter] = normalizeInspectionJobs([base], "remote");
    const [withoutFilter] = normalizeInspectionJobs([base]);

    expect(withFilter).toMatchObject({
      workMode: "remote",
      workModeSource: "portal",
      workModeConfidence: "medium",
    });
    expect(withoutFilter?.workMode).toBeUndefined();
  });
});
