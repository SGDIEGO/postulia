import { describe, expect, it } from "vitest";
import { detectSource, hashUrl, normalizeJobUrl, textSimilarity } from "./url.js";

describe("normalizeJobUrl", () => {
  it("quita parámetros de seguimiento de LinkedIn", () => {
    const result = normalizeJobUrl(
      "https://www.linkedin.com/jobs/view/4012345678/?refId=abc123&trackingId=zzz&position=1",
    );
    expect(result).toBe("https://linkedin.com/jobs/view/4012345678");
  });

  it("conserva el parámetro jk de Indeed", () => {
    const result = normalizeJobUrl(
      "https://www.indeed.com/viewjob?jk=abcdef123&utm_source=feed&from=serp",
    );
    expect(result).toBe("https://indeed.com/viewjob?jk=abcdef123");
  });

  it("normaliza host, protocolo y barra final", () => {
    const result = normalizeJobUrl("http://WWW.Computrabajo.com/ofertas-de-trabajo/x/");
    expect(result).toBe("https://computrabajo.com/ofertas-de-trabajo/x");
  });
});

describe("hashUrl", () => {
  it("genera la misma huella para URLs equivalentes", async () => {
    const a = await hashUrl("https://www.linkedin.com/jobs/view/4012345678/?refId=uno");
    const b = await hashUrl("https://linkedin.com/jobs/view/4012345678?trackingId=dos");
    expect(a).toBe(b);
  });

  it("genera huellas distintas para vacantes distintas", async () => {
    const a = await hashUrl("https://www.linkedin.com/jobs/view/111");
    const b = await hashUrl("https://www.linkedin.com/jobs/view/222");
    expect(a).not.toBe(b);
  });
});

describe("detectSource", () => {
  it("detecta el portal por dominio", () => {
    expect(detectSource("https://es.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(detectSource("https://co.computrabajo.com/oferta/1")).toBe("computrabajo");
    expect(detectSource("https://mx.indeed.com/viewjob?jk=1")).toBe("indeed");
    expect(detectSource("https://example.com/oferta/1")).toBe("other");
  });
});

describe("textSimilarity", () => {
  it("considera similares los títulos con tildes y mayúsculas distintas", () => {
    expect(textSimilarity("Desarrollador Backend", "desarrollador backend")).toBe(1);
    expect(textSimilarity("Analista de Datos", "Analista de Datos Jr")).toBeGreaterThan(0.6);
    expect(textSimilarity("Analista de Datos", "Community Manager")).toBeLessThan(0.3);
  });
});
