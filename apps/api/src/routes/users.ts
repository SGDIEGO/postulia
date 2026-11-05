import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import nodemailer from "nodemailer";
import { PDFParse } from "pdf-parse";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptUserSecret, encryptUserSecret } from "../lib/user-secrets.js";

const draftEmailSchema = z.object({
  /** Correo destinatario indicado por el usuario en el panel. */
  to: z.string().nullish(),
  author: z.string().nullish(),
  text: z.string().nullish(),
  url: z.string().nullish(),
  postedAt: z.string().nullish(),
});

const iaConfigSchema = z
  .object({
    provider: z.literal("gemini").nullable(),
    apiKey: z.string().trim().max(500).nullable(),
  })
  .superRefine((value, context) => {
    if (value.apiKey && !value.provider) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "El proveedor es obligatorio cuando se configura una API key",
      });
    }
  });

const sendReviewedEmailSchema = z.object({
  to: z.string().trim().email("El correo destinatario no es válido"),
  subject: z
    .string()
    .trim()
    .min(1, "El asunto no puede estar vacío")
    .max(300, "El asunto es demasiado largo"),
  body: z
    .string()
    .trim()
    .min(1, "El cuerpo no puede estar vacío")
    .max(20_000, "El cuerpo es demasiado largo"),
});

interface GeneratedEmail {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}

const uploadsDir = path.join(process.cwd(), ".uploads");

const DEFAULT_BODY =
  "Hola,\n\nMe interesa la oportunidad publicada en LinkedIn y me gustaría postularme. Adjunto mi CV para que puedan conocerme mejor.\n\nQuedo atento a cualquier información adicional.\n\nSaludos cordiales.";

function normalizeRecipient(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convierte el texto revisado por el usuario en HTML seguro. */
function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Extrae el texto de un PDF usando la API v2 de pdf-parse. */
async function extractPdfText(buffer: Buffer): Promise<string | null> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text?.trim() || null;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Limpia la respuesta de Gemini por si viene envuelta en ```json ... ```. */
function parseGeneratedEmail(raw: string): GeneratedEmail {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === "object") return parsed as GeneratedEmail;
  } catch {
    // Intenta rescatar el primer objeto JSON dentro del texto.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as GeneratedEmail;
      } catch {
        // Sin suerte.
      }
    }
  }

  throw badRequest("La IA no devolvió un JSON válido");
}

export default async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.post("/api/users/cv", async (request, reply) => {
    const userId = request.user.sub;

    const data = await request.file();
    if (!data) throw badRequest("Falta el archivo CV");
    if (data.mimetype !== "application/pdf") {
      throw badRequest("El archivo debe ser un PDF");
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw badRequest("El archivo PDF está vacío");

    let extractedText: string | null = null;
    try {
      extractedText = await extractPdfText(buffer);
    } catch {
      throw badRequest(
        "No se pudo leer el PDF. Asegúrate de que no esté protegido con contraseña.",
      );
    }

    const userExists = await app.prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) throw unauthorized("Usuario no encontrado");

    await mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${userId}.pdf`);
    await writeFile(filePath, buffer);

    const existing = await app.prisma.userCv.findFirst({ where: { userId } });

    let userCv;
    if (existing) {
      if (existing.filePath !== filePath) {
        await unlink(existing.filePath).catch(() => undefined);
      }
      userCv = await app.prisma.userCv.update({
        where: { id: existing.id },
        data: {
          fileName: data.filename,
          filePath,
          text: extractedText,
          uploadedAt: new Date(),
        },
      });
    } else {
      userCv = await app.prisma.userCv.create({
        data: {
          userId,
          fileName: data.filename,
          filePath,
          text: extractedText,
        },
      });
    }

    reply.code(201);
    return {
      cvText: userCv.text,
      fileName: userCv.fileName,
      uploadedAt: userCv.uploadedAt.toISOString(),
    };
  });

  app.get("/api/users/cv", async (request) => {
    const userId = request.user.sub;

    const userCv = await app.prisma.userCv.findFirst({ where: { userId } });
    if (!userCv) throw notFound("No se encontró un CV subido");

    return {
      cvText: userCv.text,
      fileName: userCv.fileName,
      uploadedAt: userCv.uploadedAt.toISOString(),
    };
  });

  app.put("/api/users/ia-config", async (request) => {
    const parsed = iaConfigSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const { provider, apiKey } = parsed.data;
    const userId = request.user.sub;
    await app.prisma.user.update({
      where: { id: userId },
      data: {
        iaProvider: provider,
        iaApiKey: provider
          ? apiKey
            ? encryptUserSecret(apiKey, app.env.JWT_SECRET)
            : undefined
          : null,
      },
    });

    return { provider, configured: Boolean(apiKey) };
  });

  /**
   * Genera un borrador con Gemini y NO envía nada. El usuario revisa y
   * corrige el destinatario, el asunto y el cuerpo antes de enviarlo.
   */
  app.post("/api/ia/draft-email", async (request) => {
    const userId = request.user.sub;

    const parsed = draftEmailSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const { to, author, text, url, postedAt } = parsed.data;

    const userCv = await app.prisma.userCv.findFirst({ where: { userId } });
    if (!userCv?.text) {
      throw badRequest("No se encontró un CV subido. Sube tu CV en Ajustes primero.");
    }

    const user = await app.prisma.user.findUnique({ where: { id: userId } });
    let apiKey = app.env.GEMINI_API_KEY;
    if (user?.iaApiKey) {
      try {
        apiKey = decryptUserSecret(user.iaApiKey, app.env.JWT_SECRET);
      } catch {
        request.log.error({ userId }, "No se pudo descifrar la API key de IA del usuario");
        throw badRequest("La API key de IA guardada no se puede utilizar. Vuelve a registrarla.");
      }
    }
    if (!apiKey) {
      throw badRequest("Configura tu API key de Gemini en Ajustes.");
    }

    const prompt = `Eres un asistente experto en búsqueda de empleo. Analiza la siguiente información.

TEXTO DEL POST DE LINKEDIN (pegado por el usuario; es una propuesta laboral publicada como post, no una oferta formal):
- Autor: ${author ?? "No disponible"}
- Fecha: ${postedAt ?? "No disponible"}
- URL: ${url ?? "No disponible"}
- Texto:
"""
${text ?? "No disponible"}
"""

CV DEL CANDIDATO:
"""
${userCv.text}
"""

Tareas:
1. Busca en el texto del post un correo electrónico de contacto o el del reclutador/empresa.
2. Redacta un correo breve y profesional en español para postularse a esa oportunidad, usando la experiencia del CV que sea relevante.
3. No inventes datos de contacto ni experiencia que no aparezcan en el post o el CV.
4. El cuerpo debe ser TEXTO PLANO listo para enviar: sin HTML, sin Markdown y sin etiquetas. Usa saltos de línea normales.
5. Incluye un saludo y una despedida. Si el CV permite saber el nombre del candidato, fírmalo con él.

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{"to": "correo@dominio.com" o null, "subject": "asunto del correo", "body": "cuerpo del correo en texto plano"}`;

    const model = app.env.GEMINI_MODEL;
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text().catch(() => "");
      request.log.error({ status: geminiRes.status, errorText }, "Gemini respondió con error");
      throw badRequest(
        `Error al contactar a Gemini (${geminiRes.status}). Revisa la API key y el modelo configurado.`,
      );
    }

    const geminiData = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!raw) throw badRequest("Gemini no devolvió contenido");

    const generated = parseGeneratedEmail(raw);

    return {
      ok: true,
      to: normalizeRecipient(to) ?? normalizeRecipient(generated.to),
      subject: generated.subject?.trim() || `Postulación - ${author ?? "oportunidad en LinkedIn"}`,
      body: generated.body?.trim() || DEFAULT_BODY,
    };
  });

  /**
   * Envía exactamente el contenido revisado por el usuario, adjuntando el CV.
   * No vuelve a llamar a Gemini.
   */
  app.post("/api/ia/send-email", async (request, reply) => {
    const userId = request.user.sub;

    const parsed = sendReviewedEmailSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

    const { to, subject, body } = parsed.data;

    const userCv = await app.prisma.userCv.findFirst({ where: { userId } });
    if (!userCv) {
      throw badRequest("No se encontró un CV subido. Sube tu CV en Ajustes primero.");
    }

    const user = await app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized("Usuario no encontrado");

    if (!app.env.SMTP_HOST || !app.env.SMTP_USER || !app.env.SMTP_PASS) {
      throw badRequest("El servidor no tiene configurado SMTP para enviar correos.");
    }

    const transporter = nodemailer.createTransport({
      host: app.env.SMTP_HOST,
      port: app.env.SMTP_PORT,
      secure: app.env.SMTP_SECURE === "true",
      auth: {
        user: app.env.SMTP_USER,
        pass: app.env.SMTP_PASS,
      },
    });

    let attachment: { filename: string; content: Buffer } | null = null;
    try {
      attachment = {
        filename: userCv.fileName,
        content: await readFile(userCv.filePath),
      };
    } catch {
      request.log.warn({ filePath: userCv.filePath }, "No se pudo leer el PDF del CV");
    }

    await transporter.sendMail({
      from: app.env.SMTP_FROM || app.env.SMTP_USER,
      to,
      subject,
      text: body,
      html: bodyToHtml(body),
      ...(attachment ? { attachments: [attachment] } : {}),
    });

    reply.code(200);
    return {
      ok: true,
      to,
      subject,
      message: `Correo enviado a ${to} con tu CV adjunto.`,
    };
  });
}
