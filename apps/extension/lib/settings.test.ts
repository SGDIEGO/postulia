// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "./settings";

describe("resolveSettings", () => {
  it("devuelve los valores por defecto cuando no hay fila guardada", () => {
    expect(resolveSettings()).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("mezcla valores parciales sin perder el resto de defaults", () => {
    const resolved = resolveSettings({
      apiUrl: "https://api.example.com",
      followUpDays: 14,
    });

    expect(resolved.apiUrl).toBe("https://api.example.com");
    expect(resolved.followUpDays).toBe(14);
    expect(resolved.syncEnabled).toBe(DEFAULT_SETTINGS.syncEnabled);
    expect(resolved.notificationsEnabled).toBe(DEFAULT_SETTINGS.notificationsEnabled);
    expect(resolved.user).toBeNull();
  });

  it("nunca devuelve null, para que Ajustes no se quede cargando", () => {
    expect(resolveSettings(null)).not.toBeNull();
    expect(resolveSettings(undefined)).not.toBeNull();
  });
});
