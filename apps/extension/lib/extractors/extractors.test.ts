// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { extractJob, extractPage } from "./index";

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

  it("no marca una oferta como remota por una mención suelta en la descripción", () => {
    document.head.innerHTML = jsonLdScript({
      "@type": "JobPosting",
      title: "Backend Developer",
      hiringOrganization: { name: "Acme" },
      jobLocation: { address: { addressLocality: "Bogotá" } },
      description: "<p>Nuestro remote team busca desarrolladores.</p>",
    });

    const result = extractJob("https://empleos.example.com/vacante/123", document);

    expect(result?.workMode).toBeNull();
  });

  it("prioriza la modalidad del portal sobre la inferida del JSON-LD", () => {
    document.head.innerHTML = jsonLdScript({
      "@type": "JobPosting",
      title: "Analista de datos",
      hiringOrganization: { name: "Data Corp" },
      description: "<p>100% remote</p>",
    });
    document.body.innerHTML = `
      <span class="job-details-jobs-unified-top-card__workplace-type">Presencial</span>
    `;

    const result = extractJob("https://co.linkedin.com/jobs/view/4012345678/", document);

    expect(result?.workMode).toBe("onsite");
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

  it("rechaza un listado de Computrabajo sin ancla de oferta", () => {
    document.body.innerHTML = `
      <h1>73 Ofertas de trabajo de informatica telecomunicaciones en remoto</h1>
      <a href="/empresas/buscar">Buscar empresas</a>
      <p class="fs13">Necesitamos tu autorización para saber dónde estás.</p>
    `;

    const result = extractJob(
      "https://pe.computrabajo.com/trabajo-de-informatica-telecomunicaciones-en-remoto",
      document,
    );

    expect(result).toBeNull();
  });

  it("captura la oferta anclada dentro de un listado de Computrabajo", () => {
    document.body.innerHTML = `
      <article class="box_offer" data-id="A892C85ED2ADF7E861373E686DCF3405" data-lc="ListOffers-Score4-0">
        <h2>
          <a class="js-o-link" href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrolladora-full-stack-junior-en-san-isidro-A892C85ED2ADF7E861373E686DCF3405#lc=ListOffers-Score4-0">
            Desarrollador/a Full Stack Junior
          </a>
        </h2>
        <p class="fs16 fc_base mt5">
          <a href="/empresas/yarkan">YARKAN SAC</a>
        </p>
        <p class="fs16 fc_base mt5"><span>San Isidro, Lima</span></p>
        <div class="fs13"><span>Presencial y remoto</span></div>
      </article>
    `;

    const result = extractJob(
      "https://pe.computrabajo.com/trabajo-de-full-stack-junior#A892C85ED2ADF7E861373E686DCF3405",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.jobTitle).toBe("Desarrollador/a Full Stack Junior");
    expect(result?.company).toBe("YARKAN SAC");
    expect(result?.location).toBe("San Isidro, Lima");
    expect(result?.workMode).toBe("hybrid");
    expect(result?.extractor).toBe("computrabajo-listing");
    expect(result?.url).toBe(
      "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrolladora-full-stack-junior-en-san-isidro-A892C85ED2ADF7E861373E686DCF3405",
    );
  });

  it("captura la tarjeta anclada con #lc=...", () => {
    document.body.innerHTML = `
      <article class="box_offer" data-id="A892C85ED2ADF7E861373E686DCF3405" data-lc="ListOffers-Score4-0">
        <h2>
          <a href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrolladora-full-stack-junior-en-san-isidro-A892C85ED2ADF7E861373E686DCF3405">
            Desarrollador/a Full Stack Junior
          </a>
        </h2>
        <p class="fs16 fc_base mt5">YARKAN SAC</p>
        <p class="fs16 fc_base mt5"><span>San Isidro, Lima</span></p>
      </article>
    `;

    const result = extractJob(
      "https://pe.computrabajo.com/trabajo-de-full-stack-junior#lc=ListOffers-Score4-0",
      document,
    );

    expect(result?.jobTitle).toBe("Desarrollador/a Full Stack Junior");
    expect(result?.extractor).toBe("computrabajo-listing");
  });

  it("extrae la ficha real de Computrabajo y toma la modalidad del título", () => {
    document.head.innerHTML = jsonLdScript({
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      title: "Soporte Técnico Jr. / remoto / rotativo / Lima",
      hiringOrganization: { "@type": "Organization", name: "Canvia" },
      jobLocation: {
        "@type": "Place",
        address: {
          addressLocality: "Lima",
          addressRegion: "Lima",
          addressCountry: "Perú",
        },
      },
      description:
        "<p>Buscamos un técnico para brindar soporte. Atención remota a través de herramientas de conexión.</p>",
    });
    document.body.innerHTML = `
      <div class="box_detail">
        <h1 class="fs24">Soporte Técnico Jr. / remoto / rotativo / Lima</h1>
        <p class="fs16">Canvia - Lima, Lima</p>
        <p class="fs13">Lima, Lima, Perú</p>
      </div>
    `;

    const result = extractJob(
      "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-soporte-tecnico-jr-remoto-rotativo-lima-en-lima-B424A9A362D5FAF361373E686DCF3405#lc=ListOffers-Score4-3",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.extractor).toBe("computrabajo");
    expect(result?.jobTitle).toBe("Soporte Técnico Jr. / remoto / rotativo / Lima");
    expect(result?.company).toBe("Canvia");
    expect(result?.location).toBe("Lima, Lima, Perú");
    expect(result?.workMode).toBe("remote");
    expect(result?.confidence).toBe("high");
  });

  it("no marca la ficha como remota por una mención suelta en la descripción", () => {
    document.body.innerHTML = `
      <div class="box_detail">
        <h1>Soporte técnico</h1>
        <a href="/empresas/acme-123">Acme SAS</a>
        <p class="fs13">Lima, Perú</p>
        <div class="description">Atención remota a través de herramientas de conexión.</div>
      </div>
    `;

    const result = extractJob(
      "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-soporte-tecnico-en-lima-123",
      document,
    );

    expect(result?.workMode).toBeNull();
  });

  it("extractPage devuelve la clasificación para explicar el rechazo", () => {
    document.body.innerHTML = `
      <h1>73 Ofertas de trabajo de informatica telecomunicaciones en remoto</h1>
      <a href="/empresas/buscar">Buscar empresas</a>
    `;

    const result = extractPage(
      "https://pe.computrabajo.com/trabajo-de-informatica-telecomunicaciones-en-remoto",
      document,
    );

    expect(result.classification.kind).toBe("listing");
    expect(result.classification.site).toBe("computrabajo");
    expect(result.job).toBeNull();
    expect(result.pageUrl).toContain("trabajo-de-informatica");
  });

  it("sigue aceptando el extractor genérico en portales sin adaptador", () => {
    document.body.innerHTML = `
      <h1>Desarrollador Backend</h1>
      <div class="company-name">Acme</div>
    `;

    const result = extractJob(
      "https://www.bumeran.com.ar/empleos/desarrollador-backend-123.html",
      document,
    );

    expect(result).not.toBeNull();
    expect(result?.jobTitle).toBe("Desarrollador Backend");
    expect(result?.company).toBe("Acme");
  });
});
