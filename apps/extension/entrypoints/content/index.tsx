import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { extractPage } from "~/lib/extractors";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { createRoot } from "react-dom/client";
import { CaptureWidget } from "./CaptureWidget";
import tailwindCss from "~/assets/tailwind.css?inline";

export default defineContentScript({
  matches: [
    "*://*.linkedin.com/*",
    "*://*.computrabajo.com/*",
    "*://*.indeed.com/*",
    "*://*.bumeran.com/*",
    "*://*.getonbrd.com/*",
    "*://*.torre.ai/*",
  ],
  runAt: "document_idle",
  main: async (ctx) => {
    /* La extracción es sincrónica, así que se responde de inmediato. */
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const request = message as { type?: string };

      if (request?.type === "postulia:extract") {
        sendResponse(extractPage(window.location.href, document));
        return false;
      }

      if (request?.type === "postulia:ping") {
        sendResponse({ ok: true, url: window.location.href });
        return false;
      }

      return false;
    });

    const ui = await createShadowRootUi(ctx, {
      name: "postulia-capture",
      position: "inline",
      anchor: "body",
      css: tailwindCss,
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<CaptureWidget />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
