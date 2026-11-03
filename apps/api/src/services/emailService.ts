import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../env.js";

let transporter: Transporter | null = null;

/**
 * Crea (o reutiliza) el transporter de Nodemailer con Gmail SMTP.
 * Requiere SMTP_USER y SMTP_PASS (App Password de Gmail, no la contraseña normal).
 */
function getTransporter(env: Env): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465, // true para 465, false para 587 (STARTTLS)
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Verifica que la conexión SMTP funcione.
 */
export async function verifySmtpConnection(env: Env): Promise<boolean> {
  try {
    const transport = getTransporter(env);
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}

/**
 * Envía un correo individual a un prospecto.
 */
export interface SendMailInput {
  to: string;
  subject: string;
  body: string; // HTML
  from?: string;
}

export async function sendMail(
  env: Env,
  input: SendMailInput,
): Promise<{ accepted: string[]; rejected: string[]; response: string }> {
  const transport = getTransporter(env);
  const info = await transport.sendMail({
    from: input.from ?? env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html: input.body,
    text: input.body.replace(/<[^>]*>/g, ""), // versión texto simple
  });

  return {
    accepted: info.accepted ?? [],
    rejected: info.rejected ?? [],
    response: info.response ?? "",
  };
}
