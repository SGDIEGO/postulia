import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `~` es el alias de la raíz de la extensión. WXT lo resuelve al compilar;
// Vitest necesita que se lo digamos para poder importar componentes.
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^~\//, replacement: root }],
  },
});
