export type VerificationPageState = "verified" | "already" | "expired" | "invalid";

const CONTENT: Record<
  VerificationPageState,
  { title: string; heading: string; message: string; tone: string; badge: string }
> = {
  verified: {
    title: "Correo confirmado · Postulia",
    heading: "¡Correo confirmado!",
    message:
      "Tu cuenta de Postulia ya está activa. Vuelve a la extensión: la sesión se iniciará sola en unos segundos.",
    tone: "#059669",
    badge: "Cuenta activa",
  },
  already: {
    title: "Correo ya confirmado · Postulia",
    heading: "Este correo ya estaba confirmado",
    message:
      "No hace falta hacer nada más. Vuelve a la extensión e inicia sesión con tu correo y contraseña.",
    tone: "#0369a1",
    badge: "Sin cambios",
  },
  expired: {
    title: "Enlace caducado · Postulia",
    heading: "El enlace caducó",
    message:
      "Los enlaces de confirmación duran 30 minutos. Abre la extensión, entra en Ajustes y pulsa «Reenviar correo» para recibir uno nuevo.",
    tone: "#b45309",
    badge: "30 minutos",
  },
  invalid: {
    title: "Enlace no válido · Postulia",
    heading: "Este enlace no es válido",
    message:
      "Puede que ya se haya usado o que esté incompleto. Abre la extensión, entra en Ajustes y pide un correo de confirmación nuevo.",
    tone: "#be123c",
    badge: "Enlace rechazado",
  },
};

/** Página mínima, sin recursos externos: se abre en cualquier navegador. */
export function verificationPage(state: VerificationPageState): string {
  const content = CONTENT[state];

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${content.title}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #f1f5f9;
        color: #0f172a;
        font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .card {
        width: 100%;
        max-width: 480px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 32px 28px;
        box-shadow: 0 18px 40px -24px rgba(15, 23, 42, 0.35);
        text-align: center;
      }
      .logo {
        display: inline-block;
        background: #2144e4;
        color: #ffffff;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.08em;
        padding: 6px 12px;
        border-radius: 999px;
      }
      .badge {
        display: inline-block;
        margin: 20px 0 0;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 999px;
        background: ${content.tone}14;
        color: ${content.tone};
      }
      h1 { margin: 12px 0 8px; font-size: 22px; line-height: 1.25; }
      p { margin: 0; font-size: 15px; line-height: 1.6; color: #475569; }
      .hint {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e2e8f0;
        font-size: 13px;
        color: #64748b;
      }
      .step { font-weight: 600; color: #1b34b9; }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="logo">POSTULIA</span>
      <div><span class="badge">${content.badge}</span></div>
      <h1>${content.heading}</h1>
      <p>${content.message}</p>
      <p class="hint">
        <span class="step">Siguiente paso:</span> abre el panel de Postulia con el icono de la
        extensión. Puedes cerrar esta pestaña.
      </p>
    </main>
  </body>
</html>`;
}
