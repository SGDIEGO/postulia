import type { UserSettings } from "@postulia/shared";
import { ApiError, apiRequest } from "./api";
import { updateSettings } from "./settings";

interface RemoteCv {
  cvText?: string | null;
  fileName: string;
  uploadedAt: string;
}

/** Lee las preferencias de la cuenta desde el backend. */
export async function loadUserSettings(): Promise<UserSettings> {
  return apiRequest<UserSettings>("/api/users/settings");
}

/** Guarda las preferencias en el backend y actualiza la caché local. */
export async function saveUserSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const saved = await apiRequest<UserSettings>("/api/users/settings", {
    method: "PUT",
    body: patch,
  });
  await updateSettings(saved);
  return saved;
}

/**
 * Copia al navegador las preferencias que viven en el servidor. Se llama al
 * iniciar sesión y al arrancar la extensión para que otro equipo reciba la
 * misma configuración. Nunca lanza: si no hay red, se conserva la caché local.
 */
export async function hydrateUserSettings(): Promise<UserSettings | null> {
  try {
    const remote = await loadUserSettings();
    await updateSettings(remote);
    return remote;
  } catch {
    return null;
  }
}

/**
 * Copia los metadatos del CV del servidor (nombre y fecha) para mostrarlos en
 * Ajustes. Si el servidor responde 404, el CV ya no existe y se limpia la caché.
 */
export async function hydrateCvMetadata(): Promise<void> {
  try {
    const remote = await apiRequest<RemoteCv>("/api/users/cv");
    await updateSettings({
      cvText: remote.cvText ?? null,
      cvFileName: remote.fileName,
      cvUploadedAt: remote.uploadedAt,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await updateSettings({ cvText: null, cvFileName: null, cvUploadedAt: null });
    }
  }
}
