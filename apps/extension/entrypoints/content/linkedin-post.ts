import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";

export interface LinkedInPostData {
  author: string | null;
  text: string | null;
  url: string | null;
  postedAt: string | null;
}

/**
 * Extrae el contenido de un post de LinkedIn (feed, no oferta de empleo).
 * Los posts tienen URLs como:
 *  - /feed/update/urn:li:activity:...
 *  - /posts/...
 */
function extractLinkedInPost(doc: Document): LinkedInPostData | null {
  // Intentar encontrar el contenedor principal del post.
  const postSelectors = [
    "[data-urn*='activity']",
    ".feed-shared-update-v2",
    ".update-components-actor",
    ".s2-composer-feed-update",
  ];

  let postEl: Element | null = null;
  for (const sel of postSelectors) {
    postEl = doc.querySelector(sel);
    if (postEl) break;
  }

  if (!postEl) return null;

  // Autor
  const authorEl =
    postEl.querySelector<HTMLElement>(".feed-shared-actor__name") ??
    postEl.querySelector<HTMLElement>("[class*='actor__name']") ??
    postEl.querySelector<HTMLElement>("a[class*='app-aware-link'] span[dir='ltr']") ??
    postEl.querySelector<HTMLElement>("span[dir='ltr']");
  const author = authorEl?.textContent?.trim() ?? null;

  // Texto del post
  const textEl =
    postEl.querySelector<HTMLElement>(
      ".feed-shared-update-v2__description-wrapper, .update-components-text, [class*='update-components-text'], .feed-shared-inline-show-more-text",
    ) ?? postEl.querySelector<HTMLElement>("[class*='feed-shared-update-v2__description']");
  const text = textEl?.textContent?.trim() ?? null;

  // URL del post
  const linkEl =
    postEl.querySelector<HTMLAnchorElement>("a[href*='/feed/update/']") ??
    postEl.querySelector<HTMLAnchorElement>("a[href*='/posts/']");
  const url = linkEl?.href ?? window.location.href;

  // Fecha
  const timeEl = postEl.querySelector<HTMLElement>("time, [class*='update-time']");
  const postedAt = timeEl?.getAttribute("datetime") ?? timeEl?.textContent?.trim() ?? null;

  if (!text && !author) return null;

  return { author, text, url, postedAt };
}

/**
 * Detecta si la URL actual es un post de LinkedIn (feed, no job).
 */
function isLinkedInPostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
    return (
      /\/feed\/update\//i.test(u.pathname) ||
      /\/posts\//i.test(u.pathname) ||
      /\/feed\/activity\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  runAt: "document_idle",
  main: async (ctx) => {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const request = message as { type?: string };

      if (request?.type === "postulia:extract-linkedin-post") {
        if (!isLinkedInPostUrl(window.location.href)) {
          sendResponse({ ok: false, error: "Esta página no es un post de LinkedIn." });
          return false;
        }

        const post = extractLinkedInPost(document);
        if (!post) {
          sendResponse({
            ok: false,
            error:
              "No se pudo extraer el contenido del post. Asegúrate de estar viendo el post completo.",
          });
          return false;
        }

        sendResponse({ ok: true, post });
        return false;
      }

      return false;
    });
  },
});
