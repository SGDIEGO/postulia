import { describe, expect, it } from "vitest";
import { parsePastedPost } from "./linkedin-post";

describe("parsePastedPost", () => {
  it("extrae el correo de contacto del texto pegado", () => {
    const parsed = parsePastedPost(
      "Buscamos desarrollador junior.\nEnvía tu CV a rrhh@empresa.com antes del viernes.",
    );

    expect(parsed.email).toBe("rrhh@empresa.com");
    expect(parsed.text).toContain("Buscamos desarrollador junior");
  });

  it("ignora los correos internos de LinkedIn", () => {
    const parsed = parsePastedPost(
      "Notificación de jobs-noreply@linkedin.com. Contacto real: talento@acme.io",
    );

    expect(parsed.email).toBe("talento@acme.io");
  });

  it("extrae la URL del post cuando viene en el texto", () => {
    const parsed = parsePastedPost(
      "Oferta disponible: https://www.linkedin.com/posts/ana-recruiter_hiring-activity-7123456789-abc/ ¡Postúlate!",
    );

    expect(parsed.url).toBe(
      "https://www.linkedin.com/posts/ana-recruiter_hiring-activity-7123456789-abc/",
    );
  });

  it("devuelve null en correo y URL cuando no aparecen", () => {
    const parsed = parsePastedPost("Buscamos un desarrollador. Escríbenos por mensaje directo.");

    expect(parsed.email).toBeNull();
    expect(parsed.url).toBeNull();
  });

  it("limpia espacios y el sufijo 'ver más'", () => {
    const parsed = parsePastedPost("  Hola   equipo.\n\n\nBuscamos   talento… ver más  ");

    expect(parsed.text).toBe("Hola equipo.\n\nBuscamos talento");
  });

  it("normaliza un texto vacío", () => {
    expect(parsePastedPost("   \n  ").text).toBe("");
  });
});
