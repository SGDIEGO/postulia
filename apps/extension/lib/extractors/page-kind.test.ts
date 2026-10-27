// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { classifyPage } from "./page-kind";

function classify(url: string) {
  return classifyPage(new URL(url), document);
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("classifyPage", () => {
  describe("Computrabajo", () => {
    it("reconoce un listado de búsqueda", () => {
      const result = classify(
        "https://pe.computrabajo.com/trabajo-de-informatica-telecomunicaciones-en-remoto",
      );

      expect(result.site).toBe("computrabajo");
      expect(result.kind).toBe("listing");
    });

    it("reconoce el buscador sin término", () => {
      expect(classify("https://pe.computrabajo.com/ofertas-de-trabajo/").kind).toBe("listing");
      expect(classify("https://co.computrabajo.com/empleos-en-bogota-dc").kind).toBe("listing");
    });

    it("reconoce la ficha real de una oferta", () => {
      const result = classify(
        "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-soporte-tecnico-jr-remoto-rotativo-lima-en-lima-B424A9A362D5FAF361373E686DCF3405",
      );

      expect(result.site).toBe("computrabajo");
      expect(result.kind).toBe("job");
    });

    it("ignora el hash #lc al clasificar la ficha", () => {
      const result = classify(
        "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-soporte-tecnico-jr-remoto-rotativo-lima-en-lima-B424A9A362D5FAF361373E686DCF3405#lc=ListOffers-Score4-3",
      );

      expect(result.kind).toBe("job");
    });

    it("trata como oferta una tarjeta anclada dentro del listado", () => {
      document.body.innerHTML = `
        <article class="box_offer" data-id="A892C85ED2ADF7E861373E686DCF3405">
          <h2>
            <a href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrolladora-full-stack-junior-en-san-isidro-A892C85ED2ADF7E861373E686DCF3405">
              Desarrollador/a Full Stack Junior
            </a>
          </h2>
        </article>
      `;

      const result = classify(
        "https://pe.computrabajo.com/trabajo-de-full-stack-junior#A892C85ED2ADF7E861373E686DCF3405",
      );

      expect(result.kind).toBe("job");
    });
  });

  describe("LinkedIn", () => {
    it("reconoce el buscador de empleos", () => {
      expect(classify("https://www.linkedin.com/jobs/search/?keywords=react").kind).toBe("listing");
    });

    it("reconoce una vacante por ruta", () => {
      expect(classify("https://www.linkedin.com/jobs/view/4012345678/").kind).toBe("job");
    });

    it("reconoce una vacante abierta desde colecciones", () => {
      expect(
        classify("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678")
          .kind,
      ).toBe("job");
    });
  });

  describe("Indeed", () => {
    it("reconoce el buscador", () => {
      expect(classify("https://mx.indeed.com/jobs?q=react").kind).toBe("listing");
      expect(classify("https://mx.indeed.com/q-react-jobs.html").kind).toBe("listing");
    });

    it("reconoce una vacante por jk", () => {
      expect(classify("https://mx.indeed.com/viewjob?jk=abc123").kind).toBe("job");
    });
  });

  it("un JSON-LD JobPosting convierte cualquier página en oferta", () => {
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Backend Developer",
      hiringOrganization: { name: "Acme" },
    })}</script>`;

    const result = classify(
      "https://pe.computrabajo.com/trabajo-de-informatica-telecomunicaciones-en-remoto",
    );

    expect(result.kind).toBe("job");
    expect(result.hasJobPosting).toBe(true);
  });

  it("deja como desconocida una página genérica", () => {
    expect(classify("https://example.com/blog/bienvenida").kind).toBe("unknown");
  });
});
