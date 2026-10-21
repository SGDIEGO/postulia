import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildApp({ env });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Cerrando Postulia API");
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Error al cerrar");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`Postulia API escuchando en http://${env.HOST}:${env.PORT}`);
  if (env.CORS_ORIGINS.includes("*") && env.NODE_ENV === "production") {
    app.log.warn(
      "CORS_ORIGINS contiene comodines; en producción conviene fijar el id exacto de la extensión",
    );
  }
} catch (error) {
  app.log.error({ err: error }, "No se pudo iniciar el servidor");
  process.exit(1);
}
