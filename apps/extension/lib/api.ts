import type { ApiErrorBody, AuthSession } from "@postulia/shared";
import { clearSession, getSettings, updateSettings, type PostuliaSettings } from "./settings";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const REFRESH_SKEW_MS = 60_000;

function tokenIsExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() - REFRESH_SKEW_MS <= Date.now();
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "invalid_json", "Respuesta no válida del servidor");
  }
}

async function performRequest(
  settings: PostuliaSettings,
  path: string,
  options: { method?: string; body?: unknown; token?: string | null },
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  return fetch(`${settings.apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Renovación en curso: evita que dos peticiones quemen el mismo refresh token. */
let refreshPromise: Promise<string | null> | null = null;

/** Intenta renovar el token de acceso con el de refresco. */
export function refreshSession(): Promise<string | null> {
  refreshPromise ??= refreshSessionInternal().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function refreshSessionInternal(): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.apiUrl || !settings.refreshToken) return null;

  try {
    const response = await performRequest(settings, "/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: settings.refreshToken },
    });

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // El refresh token ya no es válido (revocado o expirado): hay que
      // volver a iniciar sesión. Un 5xx o un fallo de red no borra la sesión.
      await clearSession();
      return null;
    }

    if (!response.ok) return null;

    const session = await parse<AuthSession>(response);
    await updateSettings({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      user: session.user,
    });
    return session.accessToken;
  } catch {
    // Sin conexión: conservamos los tokens para reintentar más adelante.
    return null;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** `false` para endpoints públicos (login/registro). */
  auth?: boolean;
}

/**
 * Petición a la API con manejo de sesión: renueva el token cuando está por
 * expirar y reintenta una vez si el servidor responde 401.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let settings = await getSettings();
  if (!settings.apiUrl) {
    throw new ApiError(0, "no_api_url", "Configura la URL de tu servidor en Ajustes");
  }

  let token = settings.accessToken;
  const needsAuth = options.auth !== false;

  if (needsAuth && (!token || tokenIsExpired(settings.accessTokenExpiresAt))) {
    token = await refreshSession();
    settings = await getSettings();
    if (!token) {
      if (!settings.refreshToken) {
        throw new ApiError(401, "no_session", "Inicia sesión para sincronizar");
      }
      throw new ApiError(
        0,
        "network_error",
        "No se pudo renovar la sesión. Revisa tu conexión e inténtalo de nuevo.",
      );
    }
  }

  let response: Response;
  try {
    response = await performRequest(settings, path, { ...options, token });
  } catch (error) {
    throw new ApiError(
      0,
      "network_error",
      error instanceof Error
        ? `No se pudo contactar el servidor: ${error.message}`
        : "No se pudo contactar el servidor",
    );
  }

  if (response.status === 401 && needsAuth) {
    const renewed = await refreshSession();
    if (renewed) {
      response = await performRequest(settings, path, { ...options, token: renewed });
    }
  }

  if (!response.ok) {
    const body = await parse<ApiErrorBody>(response).catch(() => null);
    throw new ApiError(
      response.status,
      body?.error ?? "http_error",
      body?.message ?? `Error ${response.status} del servidor`,
      body?.details,
    );
  }

  return parse<T>(response);
}

/** Comprueba que el servidor configurado responda. */
export async function pingServer(apiUrl: string): Promise<{ ok: boolean; database?: string }> {
  const settings = await getSettings();
  const base = apiUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) return { ok: false };
    const body = (await response.json()) as { status?: string; database?: string };
    return { ok: body.status === "ok", database: body.database };
  } catch {
    void settings;
    return { ok: false };
  }
}
