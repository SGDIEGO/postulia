/**
 * Servicio para generar y enviar un correo a partir de un post de LinkedIn.
 * La llamada se hace a tu propio backend (Oracle Cloud), que es quien tiene la
 * API key de Gemini, el CV del usuario y las credenciales SMTP para enviar el
 * correo con el PDF adjunto.
 */
export interface LinkedInPost {
  author: string | null;
  text: string | null;
  url: string | null;
  postedAt: string | null;
}

export interface SendEmailResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Pide al backend que genere y envíe un correo usando el post de LinkedIn,
 * el CV almacenado del usuario y las credenciales SMTP configuradas en el
 * servidor. El backend adjunta el CV (PDF) al correo.
 */
export async function sendEmailWithIA(
  accessToken: string | null,
  post: LinkedInPost,
  backendUrl: string,
): Promise<SendEmailResponse> {
  const response = await fetch(`${backendUrl.replace(/\/+$/, "")}/ia/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(post),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      error: data?.error?.message || data?.message || `Error ${response.status} del servidor`,
    };
  }

  return {
    ok: true,
    message: data?.message || "Correo enviado correctamente.",
  };
}
