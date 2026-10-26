import { describe, expect, it } from "vitest";
import {
  buildLinkedInGuestSearchUrl,
  buildLinkedInSearchUrl,
  hasLinkedInWorkModeFilter,
  parseLinkedInJobsHtml,
  withoutCurrentJobId,
} from "./linkedin-parser.js";

function cardHtml(options: {
  id: string;
  title: string;
  company: string;
  location: string;
  workType?: string;
  postedAt?: string;
}): string {
  return `
    <div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:${options.id}">
      <a class="base-card__full-link" href="https://co.linkedin.com/jobs/view/${options.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-at-acme-${options.id}?position=1"></a>
      <h3 class="base-search-card__title">${options.title}</h3>
      <h4 class="base-search-card__subtitle"><a href="/company/acme">${options.company}</a></h4>
      <span class="job-search-card__location">${options.location}</span>
      ${
        options.workType
          ? `<span class="job-search-card__workplace-type">${options.workType}</span>`
          : ""
      }
      ${
        options.postedAt
          ? `<time class="job-search-card__listdate" datetime="${options.postedAt}"></time>`
          : ""
      }
    </div>
  `;
}

describe("buildLinkedInSearchUrl", () => {
  it("no envía ubicación ni fecha cuando no están definidas", () => {
    const url = new URL(buildLinkedInSearchUrl("nodejs", {}, 0));

    expect(url.searchParams.get("keywords")).toBe("nodejs");
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("f_TPR")).toBe(false);
    expect(url.searchParams.has("f_WT")).toBe(false);
  });

  it("aplica fecha y modalidad, y pagina de 25 en 25", () => {
    const url = new URL(
      buildLinkedInSearchUrl(
        "nodejs",
        { location: "Bogotá", postedWithinDays: 7, workMode: "remote" },
        2,
      ),
    );

    expect(url.searchParams.get("location")).toBe("Bogotá, Colombia");
    expect(url.searchParams.get("f_TPR")).toBe("r604800");
    expect(url.searchParams.get("f_WT")).toBe("2");
    expect(url.searchParams.get("start")).toBe("50");
  });

  it("mapea las tres modalidades a f_WT", () => {
    const mode = (workMode: "onsite" | "remote" | "hybrid") =>
      new URL(buildLinkedInSearchUrl("nodejs", { workMode }, 0)).searchParams.get("f_WT");

    expect(mode("onsite")).toBe("1");
    expect(mode("remote")).toBe("2");
    expect(mode("hybrid")).toBe("3");
  });

  it("apunta a la página de resultados actual y evita la redirección que pierde f_WT", () => {
    const url = new URL(buildLinkedInSearchUrl("nodejs", { workMode: "remote" }, 0));

    expect(url.pathname).toBe("/jobs/search-results/");
    expect(url.searchParams.get("f_WT")).toBe("2");
  });

  it("envía el país en inglés, que es lo único que LinkedIn geocodifica", () => {
    const url = new URL(buildLinkedInSearchUrl("nodejs", { location: "Perú" }, 0));

    expect(url.searchParams.get("location")).toBe("Peru");
  });

  it("conserva la ciudad y añade el país en inglés", () => {
    const url = new URL(buildLinkedInSearchUrl("nodejs", { location: "Lima" }, 0));

    expect(url.searchParams.get("location")).toBe("Lima, Peru");
  });

  it("no envía ubicación cuando el filtro es una modalidad", () => {
    const url = new URL(buildLinkedInSearchUrl("nodejs", { location: "Remoto" }, 0));

    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("hasLinkedInWorkModeFilter", () => {
  it("reconoce el filtro cuando sobrevive a la redirección", () => {
    expect(
      hasLinkedInWorkModeFilter(
        "https://www.linkedin.com/jobs/search-results/?keywords=dev&f_WT=2",
        "remote",
      ),
    ).toBe(true);
  });

  it("reconoce varios valores separados por coma", () => {
    expect(
      hasLinkedInWorkModeFilter(
        "https://www.linkedin.com/jobs/search-results/?keywords=dev&f_WT=2%2C3",
        "hybrid",
      ),
    ).toBe(true);
  });

  it("devuelve false cuando LinkedIn descartó el filtro", () => {
    expect(
      hasLinkedInWorkModeFilter(
        "https://www.linkedin.com/jobs/search-results/?currentJobId=4481291698&keywords=dev&start=0",
        "remote",
      ),
    ).toBe(false);
  });

  it("no confunde modalidades distintas", () => {
    expect(
      hasLinkedInWorkModeFilter(
        "https://www.linkedin.com/jobs/search-results/?keywords=dev&f_WT=1",
        "remote",
      ),
    ).toBe(false);
  });

  it("tolera URLs inválidas", () => {
    expect(hasLinkedInWorkModeFilter("no-es-una-url", "remote")).toBe(false);
  });
});

describe("withoutCurrentJobId", () => {
  it("quita la oferta seleccionada para que se vea el listado", () => {
    const cleaned = withoutCurrentJobId(
      "https://www.linkedin.com/jobs/search-results/?currentJobId=4481291698&keywords=dev&f_WT=2",
    );

    expect(cleaned).toBeDefined();
    const url = new URL(cleaned!);
    expect(url.searchParams.has("currentJobId")).toBe(false);
    expect(url.searchParams.get("f_WT")).toBe("2");
    expect(url.searchParams.get("keywords")).toBe("dev");
  });

  it("no toca una URL que ya viene limpia", () => {
    expect(
      withoutCurrentJobId("https://www.linkedin.com/jobs/search-results/?keywords=dev"),
    ).toBeUndefined();
  });

  it("tolera URLs inválidas", () => {
    expect(withoutCurrentJobId("no-es-una-url")).toBeUndefined();
  });
});

describe("buildLinkedInGuestSearchUrl", () => {
  it("usa la paginación de 10 del endpoint público", () => {
    const url = new URL(buildLinkedInGuestSearchUrl("nodejs", {}, 2));

    expect(url.pathname).toBe("/jobs-guest/jobs/api/seeMoreJobPostings/search");
    expect(url.searchParams.get("start")).toBe("20");
    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("parseLinkedInJobsHtml", () => {
  it("extrae título, empresa, ubicación, fecha, URL canónica y modalidad", () => {
    const html = `
      <ul>
        <li>
          ${cardHtml({
            id: "4474336911",
            title: "Node.js Software Engineer - Remote",
            company: "Acme",
            location: "Bogotá, Colombia",
            postedAt: "2026-10-20",
          })}
        </li>
        <li>
          ${cardHtml({
            id: "4462079390",
            title: "Backend Engineer",
            company: "Globex",
            location: "Medellín, Colombia",
          })}
        </li>
      </ul>
    `;

    const jobs = parseLinkedInJobsHtml(html, 1);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobTitle: "Node.js Software Engineer - Remote",
      company: "Acme",
      location: "Bogotá, Colombia",
      url: "https://www.linkedin.com/jobs/view/4474336911/",
      workMode: "remote",
      workModeSource: "text",
      workModeConfidence: "medium",
      postedAt: "2026-10-20",
      pageNumber: 1,
    });
    expect(jobs[1]?.url).toBe("https://www.linkedin.com/jobs/view/4462079390/");
    expect(jobs[1]?.workMode).toBeUndefined();
    expect(jobs[1]?.workModeSource).toBe("unknown");
  });

  it("deduplica tarjetas repetidas", () => {
    const card = cardHtml({
      id: "1234567890",
      title: "Node Developer",
      company: "Acme",
      location: "Bogotá",
    });

    expect(parseLinkedInJobsHtml(`${card}${card}`)).toHaveLength(1);
  });

  it("prioriza la etiqueta estructurada del portal", () => {
    const html = cardHtml({
      id: "1234567890",
      title: "Remote Backend Developer",
      company: "Acme",
      location: "Bogotá",
      workType: "Hybrid",
    });

    expect(parseLinkedInJobsHtml(html)[0]).toMatchObject({
      workMode: "hybrid",
      workModeSource: "portal",
      workModeConfidence: "high",
    });
  });

  it("detecta la modalidad incluida en la ubicación de la tarjeta", () => {
    const html = cardHtml({
      id: "1234567890",
      title: "Backend Developer",
      company: "Acme",
      location: "Bogotá, Colombia (Remote)",
    });

    expect(parseLinkedInJobsHtml(html)[0]).toMatchObject({
      workMode: "remote",
      workModeSource: "text",
    });
  });

  it("no inventa una modalidad si la tarjeta no la indica", () => {
    const html = cardHtml({
      id: "1234567890",
      title: "Backend Developer",
      company: "Acme",
      location: "Bogotá",
    });

    const job = parseLinkedInJobsHtml(html)[0];
    expect(job?.workMode).toBeUndefined();
    expect(job?.workModeSource).toBe("unknown");
    expect(job?.workModeConfidence).toBe("low");
  });

  it("devuelve vacío si el HTML no tiene tarjetas", () => {
    expect(parseLinkedInJobsHtml("<html><body>Sin ofertas</body></html>")).toEqual([]);
  });
});
