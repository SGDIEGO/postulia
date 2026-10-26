import { describe, expect, it } from "vitest";
import {
  buildComputrabajoLocationSlug,
  buildComputrabajoSearchUrl,
  slugify,
} from "./computrabajo-url.js";

describe("slugify", () => {
  it("convierte el puesto en un slug de ruta", () => {
    expect(slugify("Node.js Developer")).toBe("node-js-developer");
    expect(slugify("Analista  de  datos")).toBe("analista-de-datos");
  });
});

describe("buildComputrabajoLocationSlug", () => {
  it("usa la ciudad cuando el usuario la indica", () => {
    expect(buildComputrabajoLocationSlug("Lima")).toBe("lima");
    expect(buildComputrabajoLocationSlug("Bogotá")).toBe("bogota");
    expect(buildComputrabajoLocationSlug("Santiago De Surco, Lima")).toBe("lima");
  });

  it("usa el país cuando solo se indicó el país", () => {
    expect(buildComputrabajoLocationSlug("Perú")).toBe("peru");
    expect(buildComputrabajoLocationSlug("Chile")).toBe("chile");
  });

  it("no devuelve ubicación para modalidades", () => {
    expect(buildComputrabajoLocationSlug("Remoto")).toBeUndefined();
  });

  it("ignora la modalidad cuando va mezclada con la ubicación", () => {
    expect(buildComputrabajoLocationSlug("Remoto Colombia")).toBe("colombia");
    expect(buildComputrabajoLocationSlug("Lima, Remoto")).toBe("lima");
  });
});

describe("buildComputrabajoSearchUrl", () => {
  it("usa el dominio del país buscado", () => {
    const url = new URL(buildComputrabajoSearchUrl("developer", { location: "Perú" }, 0)!);

    expect(url.hostname).toBe("pe.computrabajo.com");
    expect(url.pathname).toBe("/trabajo-de-developer-en-peru");
    expect(url.searchParams.get("p")).toBe("1");
  });

  it("usa el dominio colombiano por defecto", () => {
    const url = new URL(buildComputrabajoSearchUrl("developer", {}, 0)!);

    expect(url.hostname).toBe("co.computrabajo.com");
    expect(url.pathname).toBe("/ofertas-de-trabajo/");
    expect(url.searchParams.get("q")).toBe("developer");
  });

  it("pagina desde 1", () => {
    const url = new URL(buildComputrabajoSearchUrl("developer", { location: "Lima" }, 2)!);

    expect(url.pathname).toBe("/trabajo-de-developer-en-lima");
    expect(url.searchParams.get("p")).toBe("3");
  });

  it("cambia de dominio según el país", () => {
    expect(
      new URL(buildComputrabajoSearchUrl("developer", { location: "México" }, 0)!).hostname,
    ).toBe("mx.computrabajo.com");
    expect(
      new URL(buildComputrabajoSearchUrl("developer", { location: "Chile" }, 0)!).hostname,
    ).toBe("cl.computrabajo.com");
  });

  it("no inventa una URL para países sin portal", () => {
    expect(buildComputrabajoSearchUrl("developer", { location: "España" }, 0)).toBeUndefined();
    expect(buildComputrabajoSearchUrl("developer", { location: "Madrid" }, 0)).toBeUndefined();
  });
});
