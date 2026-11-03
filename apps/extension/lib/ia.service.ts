/**
 * Servicio para generar un borrador de correo a partir de un post de LinkedIn.
 * La llamada se hace a tu propio backend (Oracle Cloud), que es quien tiene la
 * API key de Gemini y se encarga de leer el CV del usuario.
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

/**
 * Pide al backend que genere un borrador de correo usando el post de LinkedIn
 * y el CV almacenado del usuario autenticado.
 */
export async function generateEmailDraft(
  apiUrl: string,
  accessToken: string | null,
  post: LinkedInPost,
): Promise<EmailDraft> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/ia/generate-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(post),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message || body?.message || `Error ${response.status} del servidor`,
    );
  }

  const data = await response.json();
  return {
    to: data.to ?? null,
    subject: data.subject || "",
    body: data.body || "",
  };
}
