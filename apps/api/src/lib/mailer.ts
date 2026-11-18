import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../env.js";

/** Fragmento del entorno que necesita el correo. Facilita las pruebas. */
export type MailEnv = Pick<
  Env,
  | "NODE_ENV"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_SECURE"
  | "SMTP_USER"
  | "SMTP_PASS"
  | "SMTP_FROM"
  | "PUBLIC_URL"
>;

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer }[];
}

/** ¿Hay credenciales suficientes para intentar enviar correo? */
export function isMailConfigured(env: MailEnv): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/** Remitente: `SMTP_FROM` o, si falta, la propia cuenta SMTP. */
export function senderAddress(env: MailEnv): string {
  return env.SMTP_FROM.trim() || env.SMTP_USER || "";
}

/**
 * Un único transportador por proceso: abrir una conexión SMTP por petición
 * añade latencia y agota el límite de conexiones del proveedor.
 */
let cached: { key: string; transporter: Transporter } | null = null;

export function transportFor(env: MailEnv): Transporter {
  const key = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER].join("|");
  if (cached?.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === "true",
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  cached = { key, transporter };
  return transporter;
}

/** Envía un correo con la configuración global. Lanza si el SMTP falla. */
export async function sendMail(env: MailEnv, mail: OutgoingMail): Promise<void> {
  if (!isMailConfigured(env)) {
    throw new Error("SMTP no configurado");
  }

  await transportFor(env).sendMail({
    from: senderAddress(env),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.attachments ? { attachments: mail.attachments } : {}),
  });
}

/** Cierra las conexiones del transportador (pruebas y apagado ordenado). */
export function resetMailTransport(): void {
  cached?.transporter.close?.();
  cached = null;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** URL pública del API, sin barra final. */
export function publicBaseUrl(env: MailEnv, fallback: string): string {
  return (env.PUBLIC_URL.trim() || fallback).replace(/\/+$/, "");
}

export function verificationEmail(input: {
  name: string | null;
  link: string;
  expiresAt: Date;
  ttlMinutes: number;
}): { subject: string; text: string; html: string } {
  const greeting = input.name ? `Hola ${input.name},` : "Hola,";
  const minutes = input.ttlMinutes;
  const link = input.link;

  const text = [
    greeting,
    "",
    "Gracias por crear tu cuenta en Postulia, la extensión para organizar tus postulaciones.",
    "",
    `Confirma tu correo con este enlace (caduca en ${minutes} minutos):`,
    link,
    "",
    `El enlace deja de ser válido el ${input.expiresAt.toLocaleString("es", { timeZone: "UTC" })} UTC.`,
    "Si no creaste esta cuenta, ignora este mensaje: no se activará nada.",
    "",
    "— Postulia",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
      <tr>
        <td style="padding:28px 28px 8px;">
          <div style="display:inline-block;background:#2144e4;color:#ffffff;font-weight:700;font-size:13px;letter-spacing:0.4px;padding:6px 12px;border-radius:999px;">POSTULIA</div>
          <h1 style="margin:18px 0 6px;font-size:20px;line-height:1.3;color:#0f172a;">Confirma tu correo</h1>
          <p style="margin:0;font-size:14px;line-height:1.55;color:#475569;">${escapeHtml(greeting)}</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:#475569;">
            Gracias por crear tu cuenta en Postulia. Pulsa el botón para activar tu cuenta y empezar a organizar tus postulaciones.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:#2144e4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px;">
            Confirmar mi correo
          </a>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#64748b;">
            El enlace caduca en <strong>${minutes} minutos</strong>. Si expira, pide uno nuevo desde la extensión.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 12px;" />
          <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
            Si el botón no funciona, copia este enlace en tu navegador:
          </p>
          <p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:#1b34b9;word-break:break-all;">${escapeHtml(link)}</p>
          <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
            Si no creaste esta cuenta, ignora este mensaje: no se activará nada.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: "Confirma tu correo para activar tu cuenta de Postulia",
    text,
    html,
  };
}
