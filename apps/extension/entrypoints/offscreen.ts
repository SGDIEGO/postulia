import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { handleLinkedInScrape } from "~/lib/discovery/linkedin.js";

console.log("[Offscreen] Postulia offscreen document loaded");

export default defineUnlistedScript(() => {
  // Escuchar mensajes desde background
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "discovery:linkedin:scrape") {
      handleLinkedInScrape(message.query, message.location, message.page)
        .then((result) => sendResponse({ result }))
        .catch((error) => sendResponse({ error: error.message }));
      return true; // Respuesta asíncrona
    }
    return false;
  });

  // Mantener vivo el documento offscreen
  setInterval(() => {}, 1000 * 60 * 5); // 5 min
});