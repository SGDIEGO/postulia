import { describe, expect, it } from "vitest";
import {
  buildPortalLocation,
  foldLocation,
  isCountryOnly,
  isLocationFilterActive,
  isRemoteOnly,
  matchesLocationFilter,
  resolveCountry,
} from "./location.js";

describe("foldLocation", () => {
  it("quita tildes, mayúsculas y puntuación", () => {
    expect(foldLocation("  Bogotá, D.C. ")).toBe("bogota d c");
  });

  it("tolera valores vacíos", () => {
    expect(foldLocation(undefined)).toBe("");
    expect(foldLocation("")).toBe("");
  });
});

describe("resolveCountry", () => {
  it("reconoce el país por su nombre en español y en inglés", () => {
    expect(resolveCountry("Perú")?.code).toBe("PE");
    expect(resolveCountry("Peru")?.code).toBe("PE");
    expect(resolveCountry("Colombia")?.code).toBe("CO");
    expect(resolveCountry("España")?.code).toBe("ES");
    expect(resolveCountry("Spain")?.code).toBe("ES");
  });

  it("deduce el país a partir de la ciudad", () => {
    expect(resolveCountry("Lima")?.code).toBe("PE");
    expect(resolveCountry("Bogotá")?.code).toBe("CO");
    expect(resolveCountry("Ciudad de México")?.code).toBe("MX");
    expect(resolveCountry("Buenos Aires")?.code).toBe("AR");
    expect(resolveCountry("Montevideo")?.code).toBe("UY");
    expect(resolveCountry("Santiago")?.code).toBe("CL");
  });

  it("prefiere el país explícito sobre la ciudad", () => {
    expect(resolveCountry("Santiago, España")?.code).toBe("ES");
  });

  it("devuelve undefined si no reconoce nada", () => {
    expect(resolveCountry("Marte")).toBeUndefined();
    expect(resolveCountry(undefined)).toBeUndefined();
  });
});

describe("isCountryOnly", () => {
  it("distingue país de ciudad", () => {
    expect(isCountryOnly("Perú")).toBe(true);
    expect(isCountryOnly("Peru")).toBe(true);
    expect(isCountryOnly("Lima, Perú")).toBe(false);
    expect(isCountryOnly("Lima")).toBe(false);
  });
});

describe("isRemoteOnly", () => {
  it("detecta ubicaciones que en realidad son modalidad", () => {
    expect(isRemoteOnly("Remoto")).toBe(true);
    expect(isRemoteOnly("Home office")).toBe(true);
    expect(isRemoteOnly("Remoto Colombia")).toBe(false);
    expect(isRemoteOnly("Lima")).toBe(false);
  });

  it("no considera activo un filtro que no es geográfico", () => {
    expect(isLocationFilterActive("Remoto")).toBe(false);
    expect(isLocationFilterActive("Lima")).toBe(true);
    expect(isLocationFilterActive("")).toBe(false);
  });
});

describe("buildPortalLocation", () => {
  it("manda el país en inglés, que es el único que LinkedIn entiende", () => {
    expect(buildPortalLocation("Perú")).toBe("Peru");
    expect(buildPortalLocation("Peru")).toBe("Peru");
    expect(buildPortalLocation("México")).toBe("Mexico");
    expect(buildPortalLocation("España")).toBe("Spain");
  });

  it("conserva la ciudad y añade el país en inglés", () => {
    expect(buildPortalLocation("Lima")).toBe("Lima, Peru");
    expect(buildPortalLocation("Bogotá")).toBe("Bogotá, Colombia");
    expect(buildPortalLocation("Lima, Perú")).toBe("Lima, Peru");
    expect(buildPortalLocation("Ciudad de México")).toBe("Ciudad de México, Mexico");
  });

  it("no duplica el país cuando ya viene en la ubicación", () => {
    expect(buildPortalLocation("Bogotá, Distrito Capital, Colombia")).toBe(
      "Bogotá, Distrito Capital, Colombia",
    );
  });

  it("no envía nada si la ubicación es una modalidad o está vacía", () => {
    expect(buildPortalLocation("Remoto")).toBeUndefined();
    expect(buildPortalLocation("")).toBeUndefined();
    expect(buildPortalLocation(undefined)).toBeUndefined();
  });

  it("quita la modalidad cuando va mezclada con la ubicación", () => {
    expect(buildPortalLocation("Remoto Colombia")).toBe("Colombia");
    expect(buildPortalLocation("Lima, Remoto")).toBe("Lima, Peru");
    expect(buildPortalLocation("Remoto Miami")).toBe("Miami");
  });

  it("deja pasar ubicaciones de países no soportados", () => {
    expect(buildPortalLocation("Miami")).toBe("Miami");
  });
});

describe("matchesLocationFilter", () => {
  it("no mezcla países distintos", () => {
    expect(matchesLocationFilter("Bogotá, Colombia", "Perú")).toBe(false);
    expect(matchesLocationFilter("Boise, Idaho, Estados Unidos", "Perú")).toBe(false);
    expect(matchesLocationFilter("Bogotá, Distrito Capital, Colombia", "Peru")).toBe(false);
  });

  it("acepta las ciudades del país buscado", () => {
    expect(matchesLocationFilter("Lima, Perú", "Perú")).toBe(true);
    expect(matchesLocationFilter("Santiago De Surco, Lima", "Perú")).toBe(true);
    expect(matchesLocationFilter("Lima, Peru", "Peru")).toBe(true);
    expect(matchesLocationFilter("Lima", "Perú")).toBe(true);
  });

  it("un filtro de ciudad no acepta otras ciudades del mismo país", () => {
    expect(matchesLocationFilter("Medellín, Colombia", "Bogotá")).toBe(false);
    expect(matchesLocationFilter("Bogotá, Distrito Capital, Colombia", "Bogotá")).toBe(true);
    expect(matchesLocationFilter("Bogotá", "Bogotá, Colombia")).toBe(true);
  });

  it("ignora tildes y mayúsculas", () => {
    expect(matchesLocationFilter("BOGOTA, COLOMBIA", "bogotá")).toBe(true);
    expect(matchesLocationFilter("Lima, PERÚ", "peru")).toBe(true);
  });

  it("trata las ofertas sin ubicación como no coincidentes", () => {
    expect(matchesLocationFilter(undefined, "Perú")).toBe(false);
    expect(matchesLocationFilter("", "Perú")).toBe(false);
  });

  it("usa el país del portal cuando la ciudad no está en la lista", () => {
    expect(matchesLocationFilter("Huanuco, Huanuco", "Perú", "PE")).toBe(true);
    expect(matchesLocationFilter("Viru, La Libertad", "Perú", "PE")).toBe(true);
    expect(matchesLocationFilter(undefined, "Perú", "PE")).toBe(true);
    // El país del portal no salva una oferta que dice estar en otro país.
    expect(matchesLocationFilter("Bogotá, Colombia", "Perú", "PE")).toBe(false);
    // Un filtro de ciudad sigue exigiendo la ciudad.
    expect(matchesLocationFilter("Huanuco, Huanuco", "Lima", "PE")).toBe(false);
    expect(matchesLocationFilter(undefined, "Lima", "PE")).toBe(false);
  });

  it("trata «Remoto + país» como filtro de país, no de ciudad", () => {
    expect(matchesLocationFilter("Bogotá, Colombia", "Remoto Colombia")).toBe(true);
    expect(matchesLocationFilter("Huanuco, Huanuco", "Remoto Colombia", "CO")).toBe(true);
    expect(matchesLocationFilter("Lima, Perú", "Remoto Colombia")).toBe(false);
  });

  it("no filtra si no hay ubicación o si el filtro es una modalidad", () => {
    expect(matchesLocationFilter("Bogotá, Colombia", "")).toBe(true);
    expect(matchesLocationFilter("Bogotá, Colombia", "Remoto")).toBe(true);
  });
});
