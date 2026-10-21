import type { UserProfile } from "@postulia/shared";
import { getMeta, setMeta } from "./db";

export interface PostuliaSettings {
  /** URL base del API, por ejemplo https://api.postulia.tudominio.com */
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
}

export const DEFAULT_SETTINGS: PostuliaSettings = {
  apiUrl: "",
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
};

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<PostuliaSettings> {
  const stored = await getMeta<Partial<PostuliaSettings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
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
