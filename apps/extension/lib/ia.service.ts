/**
 * Servicio de correo con IA. La llamada se hace a tu propio backend, que es
 * quien tiene la API key de Gemini del usuario, el CV del usuario y el único
 * servidor SMTP global, configurado por el administrador en sus variables de
 * entorno. El usuario nunca configura SMTP desde la extensión.
 *
 * El flujo tiene dos pasos deliberadamente separados:
 * 1. `generateEmailDraft()` pide el borrador y NO envía nada.
 * 2. `sendReviewedEmail()` envía exactamente lo que el usuario revisó.
 *
 * Ambas usan `apiRequest`, así que la sesión se renueva sola si el token de
 * acceso caducó mientras el panel estaba abierto.
 */
import { apiRequest } from "./api";

export interface LinkedInPost {
  author: string | null;
  text: string | null;
  url: string | null;
  postedAt: string | null;
}

export interface EmailDraft {
  to: string | null;
  subject: string;
  body: string;
}

export interface DraftEmailResponse {
  ok: boolean;
  draft?: EmailDraft;
  error?: string;
}

export interface SendEmailResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Genera un borrador editable con Gemini. No envía ningún correo. */
export async function generateEmailDraft(
  post: LinkedInPost,
  to?: string | null,
): Promise<DraftEmailResponse> {
  try {
    const payload = await apiRequest<{
      to?: string | null;
      subject?: string | null;
      body?: string | null;
    }>("/api/ia/draft-email", {
      method: "POST",
      body: { ...post, ...(to ? { to } : {}) },
    });

    return {
      ok: true,
      draft: {
        to: payload?.to ?? null,
        subject: payload?.subject ?? "",
        body: payload?.body ?? "",
      },
    };
  } catch (error) {
    return { ok: false, error: messageOf(error, "No se pudo generar el borrador.") };
  }
}

/** Envía el borrador revisado por el usuario, con el CV adjunto. */
export async function sendReviewedEmail(draft: EmailDraft): Promise<SendEmailResponse> {
  try {
    const payload = await apiRequest<{ message?: string }>("/api/ia/send-email", {
      method: "POST",
      body: draft,
    });

    return {
      ok: true,
      message: payload?.message || "Correo enviado correctamente.",
    };
  } catch (error) {
    return { ok: false, error: messageOf(error, "No se pudo enviar el correo.") };
  }
}
