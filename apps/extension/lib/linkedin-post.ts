/**
 * La extensión ya no lee el DOM de LinkedIn. El usuario pega el texto del post
 * y aquí se detectan los datos útiles para redactar y enviar el correo.
 */
export interface ParsedPost {
  /** Texto completo y limpio del post pegado. */
  text: string;
  /** Primer correo de contacto encontrado (ignora los de LinkedIn). */
  email: string | null;
  /** Permalink del post si viene incluido en el texto. */
  url: string | null;
  /** No se deduce del texto: se mantiene para conservar el contrato. */
  author: string | null;
  /** No se deduce del texto: se mantiene para conservar el contrato. */
  postedAt: string | null;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LINKEDIN_URL_PATTERN = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s<>"')]+/gi;

/** Detecta si una URL es el permalink de un post de LinkedIn. */
export function isLinkedInPostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false;
    return (
      /\/feed\/update\//i.test(parsed.pathname) ||
      /\/posts\//i.test(parsed.pathname) ||
      /\/feed\/activity\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function cleanPastedText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*(…|\.\.\.)?[ \t]*(ver|see)[ \t]+(más|more)[ \t]*$/gim, "")
    .trim();
}

function findEmail(text: string): string | null {
  const matches = text.match(EMAIL_PATTERN) ?? [];
  for (const match of matches) {
    const email = match.trim().replace(/[.,;:]+$/, "");
    if (/@(?:[a-z0-9-]+\.)*linkedin\.com$/i.test(email)) continue;
    if (/^(noreply|no-reply|do-not-reply)@/i.test(email)) continue;
    return email;
  }
  return null;
}

function findPostUrl(text: string): string | null {
  const matches = text.match(LINKEDIN_URL_PATTERN) ?? [];
  for (const match of matches) {
    const candidate = match.replace(/[.,;:!?]+$/, "");
    if (isLinkedInPostUrl(candidate)) return candidate;
  }
  return null;
}

/**
 * Convierte el texto pegado por el usuario en los datos que necesita el
 * backend: texto limpio, correo y URL del post (si están presentes).
 */
export function parsePastedPost(raw: string): ParsedPost {
  const text = cleanPastedText(raw);
  return {
    text,
    email: findEmail(text),
    url: findPostUrl(text),
    author: null,
    postedAt: null,
  };
}
