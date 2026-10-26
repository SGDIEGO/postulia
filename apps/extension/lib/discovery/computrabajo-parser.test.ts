import { describe, expect, it } from "vitest";
import {
  hasComputrabajoNextPage,
  parseComputrabajoDate,
  parseComputrabajoHtml,
} from "./computrabajo-parser.js";

function offerHtml(options: {
  id: string;
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  postedAt?: string;
}): string {
  return `
    <article class="box_offer" data-id="${options.id}">
      <h2 class="fs18 fwB prB">
        <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-${options.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}-en-lima-${options.id}#lc=ListOffers-Score3-0">
          ${options.title}
        </a>
      </h2>
      <p class="dFlex vm_fx fs16 fc_base mt5">${options.company ?? "Empresa confidencial"}</p>
      ${
        options.location
          ? `<p class="fs16 fc_base mt5"><span class="mr10">${options.location}</span></p>`
          : ""
      }
      ${
        options.salary
          ? `<div class="fs13 mt15"><span class="dIB mr10"><span class="icon i_salary"></span>${options.salary}</span></div>`
          : ""
      }
      ${options.postedAt ? `<p class="fs13 fc_aux mt15">${options.postedAt}</p>` : ""}
    </article>
  `;
}

describe("parseComputrabajoHtml", () => {
  it("separa ubicación, empresa, salario y fecha de una tarjeta actual", () => {
    const html = offerHtml({
      id: "D21D6E29729C987861373E686DCF3405",
      title: "Analista Programador TI",
      company: "Empresa sector Educativo",
      location: "Santiago De Surco, Lima",
      salary: "S/. 4.000,00 (Mensual)",
      postedAt: "Hace 7 días",
    });

    const [job] = parseComputrabajoHtml(html, 0, "https://pe.computrabajo.com");

    expect(job).toMatchObject({
      jobTitle: "Analista Programador TI",
      company: "Empresa sector Educativo",
      location: "Santiago De Surco, Lima",
      source: "computrabajo",
      salary: "4.000,00",
      currency: "PEN",
      confidence: "high",
    });
    expect(job?.url).toBe(
      "https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-programador-ti-en-lima-D21D6E29729C987861373E686DCF3405",
    );
  });

  it("separa la puntuación del portal de la empresa y de la ubicación", () => {
    const html = `
      <article class="box_offer" data-id="CCC333">
        <h2 class="fs18 fwB prB">
          <a class="js-o-link fc_base"
             href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-full-stack-net-en-san-borja-CCC333#lc=ListOffers-Score6-0">
            Desarrollador full stack .net
          </a>
        </h2>
        <p class="dFlex vm_fx fs16 fc_base mt5">
          <span class="fx_none mr10"><span class="fwB">4,3</span><span class="star"></span></span>
          <span class="icon i_verificada mr5"></span>
          <a class="fc_base t_ellipsis" href="https://pe.computrabajo.com/valtx"
             target="_blank" offer-grid-article-company-url>Valtx</a>
        </p>
        <p class="fs16 fc_base mt5"><span class="mr10">San Borja, Lima</span></p>
        <div class="fs13 mt15">
          <span class="dIB mr10"><span class="icon i_home_office"></span>Presencial y remoto</span>
        </div>
        <p class="fs13 fc_aux mt15">Hace 2 días</p>
      </article>
    `;

    const [job] = parseComputrabajoHtml(html, 0, "https://pe.computrabajo.com");

    expect(job?.company).toBe("Valtx");
    expect(job?.location).toBe("San Borja, Lima");
    expect(job?.salary).toBeUndefined();
    expect(job?.workMode).toBe("hybrid");
  });

  it("usa «Sin empresa» cuando la oferta es confidencial", () => {
    const [job] = parseComputrabajoHtml(offerHtml({ id: "DDD444", title: "Backend Developer" }));

    expect(job?.company).toBe("Empresa confidencial");
  });

  it("no confunde la fecha con la ubicación", () => {
    const html = offerHtml({
      id: "AAA111",
      title: "Backend Developer",
      postedAt: "Hace 3 días",
    });

    const [job] = parseComputrabajoHtml(html);

    expect(job?.location).toBeUndefined();
    expect(job?.postedAt).toBeDefined();
  });

  it("deduplica tarjetas repetidas", () => {
    const card = offerHtml({ id: "BBB222", title: "Frontend Developer" });

    expect(parseComputrabajoHtml(`${card}${card}`)).toHaveLength(1);
  });

  it("devuelve vacío si la página no tiene ofertas", () => {
    expect(parseComputrabajoHtml("<main>Sin resultados</main>")).toEqual([]);
  });
});

describe("hasComputrabajoNextPage", () => {
  it("detecta la página siguiente aunque el enlace sea un span con JavaScript", () => {
    const html = `
      <div class="dFlex vm_fx tj_fx mtB">
        <span class="b_primary_inv fwB disabled w48 cp">Anterior</span>
        <span class="b_primary w48 buildLink cp"
              data-path="https://pe.computrabajo.com/trabajo-de-developer-en-peru?p=2"
              title="Siguiente">Siguiente</span>
      </div>
    `;

    expect(hasComputrabajoNextPage(html)).toBe(true);
  });

  it("no inventa páginas en el último resultado", () => {
    const html = `
      <div class="dFlex vm_fx tj_fx mtB">
        <span class="b_primary_inv fwB w48 buildLink cp"
              data-path="https://pe.computrabajo.com/trabajo-de-developer-en-peru?p=29"
              title="Anterior">Anterior</span>
      </div>
    `;

    expect(hasComputrabajoNextPage(html)).toBe(false);
  });

  it("no confunde la paginación con otros enlaces", () => {
    expect(hasComputrabajoNextPage("<main>Sin resultados</main>")).toBe(false);
  });
});

describe("parseComputrabajoDate", () => {
  it("convierte fechas relativas en ISO", () => {
    const sevenDaysAgo = parseComputrabajoDate("Hace 7 días");
    expect(sevenDaysAgo).toBeDefined();
    const days = (Date.now() - Date.parse(sevenDaysAgo!)) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it("entiende horas y semanas", () => {
    const hours = (Date.now() - Date.parse(parseComputrabajoDate("Hace 5 horas")!)) / 3_600_000;
    const weeks = (Date.now() - Date.parse(parseComputrabajoDate("Hace 2 semanas")!)) / 604_800_000;

    expect(hours).toBeCloseTo(5, 1);
    expect(weeks).toBeCloseTo(2, 1);
  });

  it("devuelve undefined si no hay fecha reconocible", () => {
    expect(parseComputrabajoDate("")).toBeUndefined();
    expect(parseComputrabajoDate("Fecha desconocida")).toBeUndefined();
  });
});
