import { describe, expect, it } from "vitest";
import { detectWorkModeFromText, parseWorkModeLabel } from "./application.js";

describe("parseWorkModeLabel", () => {
  it("interpreta una etiqueta estructurada del portal", () => {
    expect(parseWorkModeLabel("Remote")).toMatchObject({
      workMode: "remote",
      source: "portal",
      confidence: "high",
    });
    expect(parseWorkModeLabel("Hybrid")).toMatchObject({
      workMode: "hybrid",
      source: "portal",
      confidence: "high",
    });
    expect(parseWorkModeLabel("On-site")).toMatchObject({
      workMode: "onsite",
      source: "portal",
      confidence: "high",
    });
  });

  it("devuelve undefined si la etiqueta no describe una modalidad", () => {
    expect(parseWorkModeLabel("Bogotá, Colombia")).toBeUndefined();
    expect(parseWorkModeLabel("")).toBeUndefined();
  });
});

describe("detectWorkModeFromText", () => {
  it("detecta frases explícitas de trabajo remoto", () => {
    expect(detectWorkModeFromText("100 % remoto")).toMatchObject({
      workMode: "remote",
      confidence: "high",
    });
    expect(detectWorkModeFromText("Trabajo remoto en Colombia")).toMatchObject({
      workMode: "remote",
      source: "text",
    });
    expect(detectWorkModeFromText("Fully remote position")).toMatchObject({
      workMode: "remote",
      confidence: "high",
    });
  });

  it("prioriza híbrido cuando la oferta menciona remoto e híbrido", () => {
    expect(detectWorkModeFromText("Modelo híbrido con días remotos")).toMatchObject({
      workMode: "hybrid",
    });
  });

  it("detecta presencial y no lo confunde con remoto", () => {
    expect(detectWorkModeFromText("Presencial en Bogotá")).toMatchObject({
      workMode: "onsite",
    });
  });

  it("no confunde «remote team» con una oferta remota en descripciones", () => {
    expect(
      detectWorkModeFromText("Nuestro remote team busca desarrolladores", {
        requireExplicit: true,
      }),
    ).toBeUndefined();
  });

  it("acepta «remote team» en títulos o ubicaciones", () => {
    expect(detectWorkModeFromText("Remote team lead")).toMatchObject({
      workMode: "remote",
    });
  });

  it("no inventa una modalidad si no hay pistas", () => {
    expect(detectWorkModeFromText("Desarrollador Backend en Bogotá")).toBeUndefined();
  });
});
