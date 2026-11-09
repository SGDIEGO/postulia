import type { UserProfile } from "@postulia/shared";
import { getMeta, setMeta } from "./db";

/**
 * URL fija del backend central (Oracle Cloud). Es la misma para todos los
 * usuarios: registro, login, CV, generación de correo con IA, etc.
 * Reemplaza este valor por la URL real de tu servidor desplegado.
 */
export const BACKEND_URL = "http://localhost:3000";

export interface PostuliaSettings {
  /** URL base de la API, por ejemplo https://api.postulia.tudominio.com */
  apiUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  user: UserProfile | null;
  /** Marca temporal del servidor hasta la que se sincronizó. */
  lastPulledAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncEnabled: boolean;
  notificationsEnabled: boolean;
  /** Días sugeridos para hacer seguimiento a una postulación. */
  followUpDays: number;
  /** Proveedor de IA configurado (por ahora "gemini"). */
  iaProvider: string | null;
  /** Copia local temporal para mostrar el estado del formulario; la fuente es el servidor. */
  iaApiKey: string | null;
  /** Modelo de Gemini elegido por el usuario; null = modelo por defecto del servidor. */
  iaModel: string | null;
  /** Texto extraído del CV (PDF subido una vez por el usuario). */
  cvText: string | null;
  /** Nombre original del archivo CV. */
  cvFileName: string | null;
  /** Fecha de subida del CV. */
  cvUploadedAt: string | null;
}

export const DEFAULT_SETTINGS: PostuliaSettings = {
  apiUrl: BACKEND_URL,
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  user: null,
  lastPulledAt: null,
  lastSyncAt: null,
  lastSyncError: null,
  syncEnabled: true,
  notificationsEnabled: true,
  followUpDays: 7,
  iaProvider: null,
  iaApiKey: null,
  iaModel: null,
  cvText: null,
  cvFileName: null,
  cvUploadedAt: null,
};

const SETTINGS_KEY = "settings";

/**
 * Combina lo guardado con los valores por defecto. Se usa tanto al leer de
 * IndexedDB como en la vista de Ajustes, donde una fila ausente no debe
 * confundirse con “todavía cargando”.
 */
export function resolveSettings(stored?: Partial<PostuliaSettings> | null): PostuliaSettings {
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function getSettings(): Promise<PostuliaSettings> {
  const stored = await getMeta<Partial<PostuliaSettings>>(SETTINGS_KEY);
  return resolveSettings(stored);
}

export async function updateSettings(patch: Partial<PostuliaSettings>): Promise<PostuliaSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await setMeta(SETTINGS_KEY, next);
  return next;
}

export async function clearSession(): Promise<PostuliaSettings> {
  return updateSettings({
    accessToken: null,
    refreshToken: null,
    accessTokenExpiresAt: null,
    user: null,
    lastPulledAt: null,
    lastSyncError: null,
  });
}

export function hasSession(settings: PostuliaSettings): boolean {
  return Boolean(settings.apiUrl && settings.refreshToken);
}

export function normalizeApiUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
