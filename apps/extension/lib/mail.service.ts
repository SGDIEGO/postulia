import { browser } from "wxt/browser";

/**
 * Genera un enlace `mailto:` para que el usuario abra su cliente de correo
 * con el borrador ya relleno. Se usa para pruebas antes de integrar un envío
 * directo por SMTP o Gmail API.
 */
export function buildMailtoLink(options: {
  to?: string | null;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams();
  if (options.to) params.set("to", options.to);
  params.set("subject", options.subject);
  params.set("body", options.body);
  return `mailto:?${params.toString()}`;
}

/**
 * Abre el enlace `mailto:` en una nueva pestaña del navegador.
 */
export async function openMailto(options: {
  to?: string | null;
  subject: string;
  body: string;
}): Promise<void> {
  const url = buildMailtoLink(options);
  await browser.runtime.openOptionsPage?.().catch(() => undefined);
  // Usamos la pestaña actual del dashboard o una nueva.
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    await browser.tabs.create({ url, openerTabId: tabs[0].index });
  } else {
    await browser.tabs.create({ url });
  }
}
