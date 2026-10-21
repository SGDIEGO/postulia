// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { extractJob } from "./index";

function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("extractJob", () => {
  it("extrae una oferta desde JSON-LD en un portal desconocido", () => {
    document.head.innerHTML = jsonLdScript({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Backend Developer",
      datePosted: "2026-10-01",
      employmentType: "FULL_TIME",
      hiringOrganization: { "@type": "Organization", name: "Acme" },
      jobLocation: {
        "@type": "Place",
        address: {
          addressLocality: "Bogotá",
          addressCountry: "CO",
        },
      },
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", minValue: 3000, maxValue: 5000, unitText: "MONTH" },
      },
      description: "<p>Buscamos un <strong>backend</strong> con Node.js</p>",
    });

    const result = extractJob("https://empleos.example.com/vacante/123", document);

    expect(result).not.toBeNull();
    expect(result?.jobTitle).toBe("Backend Developer");
    expect(result?.company).toBe("Acme");
    expect(result?.location).toBe("Bogotá, CO");
    expect(result?.salary).toBe("3000 - 5000 MONTH");
    expect(result?.currency).toBe("USD");
    expect(result?.contractType).toBe("full_time");
    expect(result?.description).toContain("backend con Node.js");
    expect(result?.confidence).toBe("high");
    expect(result?.source).toBe("other");
    expect(result?.missing).toEqual([]);
  });

  it("extrae los datos de LinkedIn y normaliza la URL de la vacante", () => {
    document.body.innerHTML = `
      <h1 class="job-details-jobs-unified-top-card__job-title">Analista de datos</h1>
      <div class="job-details-jobs-unified-top-card__company-name"><a>Data Corp</a></div>
      <div class="job-details-jobs-unified-top-card__primary-description-container">
        <span class="tvm__text">Medellín, Colombia · Hace 2 días</span>
      </div>
      <span class="job-details-jobs-unified-top-card__workplace-type">Híbrido</span>
    `;

    const result = extractJob(
      "https://co.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=xyz",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.jobTitle).toBe("Analista de datos");
    expect(result?.company).toBe("Data Corp");
    expect(result?.workMode).toBe("hybrid");
    expect(result?.url).toBe("https://linkedin.com/jobs/view/4012345678");
    expect(result?.extractor).toBe("linkedin");
    expect(result?.confidence).toBe("high");
  });

  it("extrae Indeed conservando el identificador jk", () => {
    document.body.innerHTML = `
      <h1 class="jobsearch-JobInfoHeader-title">Senior React Engineer</h1>
      <div data-testid="inlineHeader-companyName">Globex</div>
      <div data-testid="inlineHeader-companyLocation">Remoto</div>
      <div id="jobDescriptionText"><p>React, TypeScript y Node.js</p></div>
    `;

    const result = extractJob(
      "https://mx.indeed.com/viewjob?jk=abc123&utm_source=feed&from=serp",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.jobTitle).toBe("Senior React Engineer");
    expect(result?.company).toBe("Globex");
    expect(result?.workMode).toBe("remote");
    expect(result?.url).toBe("https://indeed.com/viewjob?jk=abc123");
    expect(result?.source).toBe("indeed");
  });

  it("combina JSON-LD con selectores cuando faltan campos", () => {
    document.head.innerHTML = jsonLdScript({
      "@type": "JobPosting",
      title: "Product Designer",
      hiringOrganization: { name: "Design Co" },
      jobLocationType: "TELECOMMUTE",
    });
    document.body.innerHTML = `<div class="salary">USD 2.000 - 3.000</div>`;

    const result = extractJob("https://example.com/jobs/designer", document);

    expect(result?.jobTitle).toBe("Product Designer");
    expect(result?.company).toBe("Design Co");
    expect(result?.workMode).toBe("remote");
    expect(result?.missing).toEqual([]);
  });

  it("devuelve null cuando la página no parece una oferta", () => {
    document.title = "Mi blog personal";
    document.body.innerHTML = "<h1>Bienvenido a mi blog</h1><p>Sobre mí</p>";

    const result = extractJob("https://example.com/blog/bienvenida", document);

    expect(result).toBeNull();
  });

  it("detecta ofertas de Computrabajo por URL y selectores", () => {
    document.body.innerHTML = `
      <div class="box_detail">
        <h1>Desarrollador Full Stack</h1>
        <a href="/empresas/acme-123">Acme SAS</a>
        <p class="fs13">Bogotá, D.C.</p>
      </div>
    `;

    const result = extractJob(
      "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-desarrollador-full-stack-123",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.extractor).toBe("computrabajo");
    expect(result?.jobTitle).toBe("Desarrollador Full Stack");
    expect(result?.company).toBe("Acme SAS");
    expect(result?.source).toBe("computrabajo");
  });
});
