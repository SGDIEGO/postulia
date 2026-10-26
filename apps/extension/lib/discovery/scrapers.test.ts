import { describe, expect, it } from "vitest";
import { buildIndeedSearchUrl } from "./indeed-url.js";

describe("buildIndeedSearchUrl", () => {
  it("no envía filtro de modalidad cuando no se pidió", () => {
    const url = new URL(buildIndeedSearchUrl("nodejs", { location: "Bogotá" }, 0));

    expect(url.searchParams.get("q")).toBe("nodejs");
    expect(url.searchParams.get("l")).toBe("Bogotá");
    expect(url.searchParams.has("sc")).toBe(false);
  });

  it("envía el filtro nativo de remoto", () => {
    const url = new URL(buildIndeedSearchUrl("nodejs", { workMode: "remote" }, 0));

    expect(url.searchParams.get("sc")).toBe("0kf:attr(DSQF7);");
  });

  it("envía el filtro nativo de híbrido", () => {
    const url = new URL(buildIndeedSearchUrl("nodejs", { workMode: "hybrid" }, 0));

    expect(url.searchParams.get("sc")).toBe("0kf:attr(PAXZC);");
  });

  it("no inventa un filtro para presencial", () => {
    const url = new URL(buildIndeedSearchUrl("nodejs", { workMode: "onsite" }, 0));

    expect(url.searchParams.has("sc")).toBe(false);
  });

  it("busca en el dominio del país de la ubicación", () => {
    expect(new URL(buildIndeedSearchUrl("nodejs", { location: "Perú" }, 0)).hostname).toBe(
      "pe.indeed.com",
    );
    expect(new URL(buildIndeedSearchUrl("nodejs", { location: "Lima" }, 0)).hostname).toBe(
      "pe.indeed.com",
    );
    expect(new URL(buildIndeedSearchUrl("nodejs", { location: "México" }, 0)).hostname).toBe(
      "mx.indeed.com",
    );
  });

  it("usa el dominio colombiano cuando no reconoce la ubicación", () => {
    expect(new URL(buildIndeedSearchUrl("nodejs", {}, 0)).hostname).toBe("co.indeed.com");
    expect(new URL(buildIndeedSearchUrl("nodejs", { location: "Marte" }, 0)).hostname).toBe(
      "co.indeed.com",
    );
  });
});
