import type {
  AuthSession,
  LoginInput,
  RegisterInput,
  RegisterResult,
  UserProfile,
  VerificationChallenge,
  VerificationStatus,
} from "@postulia/shared";
import { browser } from "wxt/browser";
import { ApiError, apiRequest } from "./api";
import {
  clearSession,
  getSettings,
  hasSession,
  updateSettings,
  type PendingVerification,
} from "./settings";
import { hydrateCvMetadata, hydrateUserSettings } from "./user-config";

export type AuthOutcome =
  | { status: "session"; user: UserProfile }
  | { status: "verification_required"; verification: PendingVerification };

export type VerificationCheck =
  | { status: "pending" }
  | { status: "verified"; user: UserProfile }
  | { status: "verified_no_session" }
  | { status: "expired" }
  | { status: "none" };

function toPending(challenge: VerificationChallenge): PendingVerification {
  return {
    email: challenge.email,
    verificationToken: challenge.verificationToken,
    expiresAt: challenge.expiresAt,
  };
}

export async function login(input: LoginInput): Promise<AuthOutcome> {
  try {
    const session = await apiRequest<AuthSession>("/api/auth/login", {
      method: "POST",
      body: input,
      auth: false,
    });
    await persistSession(session);
    return { status: "session", user: session.user };
  } catch (error) {
    // Cuenta creada pero sin confirmar: el servidor devuelve un token para
    // seguir el estado sin volver a escribir la contraseña.
    if (error instanceof ApiError && error.status === 403 && error.code === "email_not_verified") {
      const challenge = error.details as VerificationChallenge | undefined;
      if (challenge?.verificationToken) {
        const verification = toPending(challenge);
        await updateSettings({ pendingVerification: verification });
        return { status: "verification_required", verification };
      }
    }
    throw error;
  }
}

export async function register(input: RegisterInput): Promise<AuthOutcome> {
  const result = await apiRequest<RegisterResult>("/api/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });

  if ("accessToken" in result) {
    await persistSession(result);
    return { status: "session", user: result.user };
  }

  const verification = toPending(result);
  await updateSettings({ pendingVerification: verification });
  return { status: "verification_required", verification };
}

/**
 * Consulta si el enlace del correo ya se abrió. Cuando el servidor confirma,
 * devuelve la sesión; hasta entonces no se guarda ningún token.
 */
export async function checkVerification(): Promise<VerificationCheck> {
  const { pendingVerification } = await getSettings();
  if (!pendingVerification) return { status: "none" };

  try {
    const result = await apiRequest<VerificationStatus>("/api/auth/verify-email/status", {
      method: "POST",
      body: { token: pendingVerification.verificationToken },
      auth: false,
    });

    if (result.status === "pending") return { status: "pending" };
    if (result.status === "expired") return { status: "expired" };

    if (!result.session) {
      // Ya se emitió una sesión para este enlace hace tiempo: hay que entrar
      // con correo y contraseña.
      await updateSettings({ pendingVerification: null });
      return { status: "verified_no_session" };
    }

    await persistSession(result.session);
    await updateSettings({ pendingVerification: null });
    return { status: "verified", user: result.session.user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await updateSettings({ pendingVerification: null });
      return { status: "none" };
    }
    throw error;
  }
}

/** Pide otro correo de confirmación. Devuelve null si la cuenta ya estaba activa. */
export async function resendVerification(): Promise<PendingVerification | null> {
  const { pendingVerification } = await getSettings();
  if (!pendingVerification) throw new Error("No hay una verificación pendiente.");

  const result = await apiRequest<{
    status: "verification_sent" | "verified";
    email: string;
    verificationToken: string;
    expiresAt: string;
  }>("/api/auth/verify-email/resend", {
    method: "POST",
    body: { token: pendingVerification.verificationToken },
    auth: false,
  });

  if (result.status === "verified") {
    await updateSettings({ pendingVerification: null });
    return null;
  }

  const verification = toPending(result);
  await updateSettings({ pendingVerification: verification });
  return verification;
}

/** Abandona la espera (la cuenta sin confirmar queda sin usar). */
export async function cancelVerification(): Promise<void> {
  await updateSettings({ pendingVerification: null });
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
    pendingVerification: null,
  });

  // Trae la configuración de la cuenta para que al entrar desde otro equipo
  // el usuario encuentre sus preferencias y su CV ya cargados.
  await hydrateUserSettings();
  await hydrateCvMetadata();
}

/**
 * Pide permiso de acceso (host permission) para la URL de la API configurada.
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
