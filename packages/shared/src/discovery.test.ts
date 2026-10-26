import { describe, expect, it } from "vitest";
import { matchesWorkModeFilter } from "./discovery.js";

describe("matchesWorkModeFilter", () => {
  it("sin filtro acepta cualquier oferta", () => {
    expect(matchesWorkModeFilter({ workMode: "onsite" }, {})).toBe(true);
    expect(matchesWorkModeFilter({}, {})).toBe(true);
  });

  it("excluye las ofertas sin modalidad cuando se filtra", () => {
    expect(matchesWorkModeFilter({}, { workMode: "remote" })).toBe(false);
  });

  it("excluye una modalidad distinta", () => {
    expect(matchesWorkModeFilter({ workMode: "onsite" }, { workMode: "remote" })).toBe(false);
  });

  it("incluye las ofertas sin modalidad solo si se pide explícitamente", () => {
    expect(matchesWorkModeFilter({}, { workMode: "remote", includeUnknownWorkMode: true })).toBe(
      true,
    );
  });

  it("con «incluir desconocidas» sigue excluyendo otras modalidades", () => {
    expect(
      matchesWorkModeFilter(
        { workMode: "hybrid" },
        { workMode: "remote", includeUnknownWorkMode: true },
      ),
    ).toBe(false);
  });
});
