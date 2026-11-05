/**
 * Servicio de correo con IA. La llamada se hace a tu propio backend, que es
 * quien tiene la API key de Gemini, el CV del usuario y las credenciales SMTP.
 *
 * El flujo tiene dos pasos deliberadamente separados:
 * 1. `generateEmailDraft()` pide el borrador y NO envía nada.
 * 2. `sendReviewedEmail()` envía exactamente lo que el usuario revisó.
 */
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

function backendError(data: unknown, status: number): string {
  const payload = data as { error?: { message?: string }; message?: string } | null;
  return payload?.error?.message || payload?.message || `Error ${status} del servidor`;
}

/** Genera un borrador editable con Gemini. No envía ningún correo. */
export async function generateEmailDraft(
  accessToken: string | null,
  post: LinkedInPost,
  backendUrl: string,
  to?: string | null,
): Promise<DraftEmailResponse> {
  const response = await fetch(
    `${backendUrl.replace(/\/+$/, "")}/api/ia/draft-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ...post, ...(to ? { to } : {}) }),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, error: backendError(data, response.status) };
  }

  const payload = data as {
    to?: string | null;
    subject?: string | null;
    body?: string | null;
  } | null;

  return {
    ok: true,
    draft: {
      to: payload?.to ?? null,
      subject: payload?.subject ?? "",
      body: payload?.body ?? "",
    },
  };
}

/** Envía el borrador revisado por el usuario, con el CV adjunto. */
export async function sendReviewedEmail(
  accessToken: string | null,
  draft: EmailDraft,
  backendUrl: string,
): Promise<SendEmailResponse> {
  const response = await fetch(
    `${backendUrl.replace(/\/+$/, "")}/api/ia/send-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(draft),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, error: backendError(data, response.status) };
  }

  return {
    ok: true,
    message: (data as { message?: string } | null)?.message || "Correo enviado correctamente.",
  };
}
