import type { AuthSession, LoginInput, RegisterInput, UserProfile } from "@postulia/shared";
import { browser } from "wxt/browser";
import { apiRequest } from "./api";
import { clearSession, getSettings, hasSession, updateSettings } from "./settings";

export async function login(input: LoginInput): Promise<UserProfile> {
  const session = await apiRequest<AuthSession>("/api/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  await persistSession(session);
  return session.user;
}

export async function register(input: RegisterInput): Promise<UserProfile> {
  const session = await apiRequest<AuthSession>("/api/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });
  await persistSession(session);
  return session.user;
}

export async function logout(): Promise<void> {
  const settings = await getSettings();
  if (settings.refreshToken) {
    await apiRequest<void>("/api/auth/logout", {
      method: "POST",
      body: { refreshToken: settings.refreshToken },
      auth: false,
    }).catch(() => undefined);
  }
  await clearSession();
}

export async function currentSession(): Promise<{ loggedIn: boolean; user: UserProfile | null }> {
  const settings = await getSettings();
  return { loggedIn: hasSession(settings), user: settings.user };
}

async function persistSession(session: AuthSession): Promise<void> {
  await updateSettings({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    user: session.user,
  });
}

/**
 * Pide permiso de acceso (host permission) para la URL del API configurada.
 * Debe llamarse desde una acción del usuario (clic en un botón).
 */
export async function ensureApiPermission(apiUrl: string): Promise<boolean> {
  if (!apiUrl) return false;
  let origin: string;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    return false;
  }

  const pattern = `${origin}/*`;
  const has = await browser.permissions.contains({ origins: [pattern] });
  if (has) return true;
  return browser.permissions.request({ origins: [pattern] });
}
