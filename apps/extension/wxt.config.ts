import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  srcDir: ".",
  manifest: {
    name: "Postulia — Seguimiento de postulaciones",
    short_name: "Postulia",
    description:
      "Guarda ofertas de LinkedIn, Computrabajo, Indeed y más, y administra todo tu proceso de postulación: estados, kanban, recordatorios y estadísticas.",
    version: "0.1.0",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    permissions: [
      "storage",
      "alarms",
      "notifications",
      "sidePanel",
      "tabs",
      "activeTab",
      "scripting",
    ],
    optional_host_permissions: ["https://*/*", "http://localhost/*"],
    action: {
      default_title: "Postulia — abrir panel",
    },
    options_ui: undefined,
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
