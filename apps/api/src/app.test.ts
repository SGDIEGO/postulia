import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ApplicationSync, AuthSession, SyncPushResult } from "@postulia/shared";
import { buildApp } from "./app.js";
import type { Env } from "./env.js";
import { createFakePrisma } from "./testing/fake-prisma.js";

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://postulia:postulia@localhost:5432/postulia",
  JWT_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  CORS_ORIGINS: "chrome-extension://*",
  RATE_LIMIT_MAX: 10_000,
  RATE_LIMIT_WINDOW: "1 minute",
  ALLOW_REGISTRATION: true,
};

async function setup() {
  const prisma = createFakePrisma();
  const app = await buildApp({
    env: testEnv,
    prisma: prisma as unknown as PrismaClient,
    logger: false,
  });
  await app.ready();
  return app;
}

async function register(
  app: Awaited<ReturnType<typeof setup>>,
  email = "diego@example.com",
): Promise<AuthSession> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "contrasena-larga-123", name: "Diego" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<AuthSession>();
}

const sampleApplication = {
  jobTitle: "Desarrollador Backend Senior",
  company: "Acme Corp",
  url: "https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=xyz",
  source: "linkedin",
  location: "Remoto (LATAM)",
  workMode: "remote",
  status: "applied",
  tags: ["backend", "remoto"],
};

describe("salud del servicio", () => {
  it("responde en /health", async () => {
    const app = await setup();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", database: "up" });
    await app.close();
  });
});

describe("autenticación", () => {
  it("registra, devuelve sesión y permite consultar /api/me", async () => {
    const app = await setup();
    const session = await register(app);

    expect(session.user.email).toBe("diego@example.com");
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: "diego@example.com", name: "Diego" });

    const anonymous = await app.inject({ method: "GET", url: "/api/me" });
    expect(anonymous.statusCode).toBe(401);

    await app.close();
  });

  it("rechaza correos duplicados y contraseñas incorrectas", async () => {
    const app = await setup();
    await register(app);

    const duplicated = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "DIEGO@example.com", password: "otra-contrasena-larga" },
    });
    expect(duplicated.statusCode).toBe(409);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "diego@example.com", password: "no-es-la-correcta" },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "diego@example.com", password: "contrasena-larga-123" },
    });
    expect(login.statusCode).toBe(200);

    await app.close();
  });

  it("rota el token de refresco y lo invalida al usarlo dos veces", async () => {
    const app = await setup();
    const session = await register(app);

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json<AuthSession>();
    expect(rotated.refreshToken).not.toBe(session.refreshToken);

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    expect(replay.statusCode).toBe(401);

    await app.close();
  });
});

describe("postulaciones", () => {
  it("crea, detecta duplicados, cambia de estado y elimina", async () => {
    const app = await setup();
    const session = await register(app);
    const auth = { authorization: `Bearer ${session.accessToken}` };

    const created = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: auth,
      payload: sampleApplication,
    });
    expect(created.statusCode).toBe(201);
    const application = created.json<ApplicationSync>();
    expect(application.urlHash).toBeTruthy();
    expect(application.appliedAt).toBeTruthy();
    expect(application.tags).toEqual(["backend", "remoto"]);

    const duplicated = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: auth,
      payload: { ...sampleApplication, url: "https://es.linkedin.com/jobs/view/4012345678" },
    });
    expect(duplicated.statusCode).toBe(409);
    expect(duplicated.json().details.application.id).toBe(application.id);

    const lookup = await app.inject({
      method: "GET",
      url: `/api/applications/lookup?url=${encodeURIComponent("https://linkedin.com/jobs/view/4012345678")}`,
      headers: auth,
    });
    expect(lookup.json()).toMatchObject({ duplicate: true });

    const forced = await app.inject({
      method: "POST",
      url: "/api/applications?force=1",
      headers: auth,
      payload: { ...sampleApplication, status: "saved" },
    });
    expect(forced.statusCode).toBe(201);

    const listed = await app.inject({ method: "GET", url: "/api/applications", headers: auth });
    expect(listed.json().total).toBe(2);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/applications/${application.id}`,
      headers: auth,
      payload: { status: "interview", notes: "Entrevista técnica el jueves" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<ApplicationSync>().status).toBe("interview");

    const timeline = await app.inject({
      method: "GET",
      url: `/api/applications/${application.id}/timeline`,
      headers: auth,
    });
    const events =
      timeline.json<{ type: string; fromStatus: string | null; toStatus: string | null }[]>();
    expect(events.some((event) => event.type === "created")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "status_change" &&
          event.fromStatus === "applied" &&
          event.toStatus === "interview",
      ),
    ).toBe(true);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/applications/${application.id}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);

    const afterDelete = await app.inject({
      method: "GET",
      url: "/api/applications",
      headers: auth,
    });
    expect(afterDelete.json().total).toBe(1);

    await app.close();
  });

  it("no permite ver postulaciones de otro usuario", async () => {
    const app = await setup();
    const owner = await register(app, "owner@example.com");
    const intruder = await register(app, "intruder@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: sampleApplication,
    });
    const application = created.json<ApplicationSync>();

    const attempt = await app.inject({
      method: "GET",
      url: `/api/applications/${application.id}`,
      headers: { authorization: `Bearer ${intruder.accessToken}` },
    });
    expect(attempt.statusCode).toBe(404);

    await app.close();
  });
});

describe("sincronización", () => {
  it("sube cambios locales, resuelve conflictos y los devuelve en el pull", async () => {
    const app = await setup();
    const session = await register(app);
    const auth = { authorization: `Bearer ${session.accessToken}` };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const push = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: auth,
      payload: {
        applications: [
          {
            id,
            jobTitle: "Analista de Datos",
            company: "DataCo",
            source: "computrabajo",
            status: "applied",
            tags: ["datos"],
            createdAt: now,
            updatedAt: now,
          },
        ],
        tags: [{ id: crypto.randomUUID(), name: "datos", createdAt: now, updatedAt: now }],
      },
    });
    expect(push.statusCode).toBe(200);
    const pushed = push.json<SyncPushResult>();
    expect(pushed.applied.applications).toEqual([id]);

    const pull = await app.inject({
      method: "GET",
      url: "/api/sync/pull?since=1970-01-01T00:00:00.000Z",
      headers: auth,
    });
    const pulled = pull.json<{ applications: ApplicationSync[] }>();
    expect(pulled.applications).toHaveLength(1);
    expect(pulled.applications[0]?.tags).toEqual(["datos"]);

    // Un cambio más antiguo no debe sobrescribir al del servidor.
    const stale = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: auth,
      payload: {
        applications: [
          {
            id,
            jobTitle: "Analista de Datos Jr",
            company: "DataCo",
            source: "computrabajo",
            status: "saved",
            tags: [],
            createdAt: now,
            updatedAt: "2000-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(stale.json<SyncPushResult>().conflicts.applications).toHaveLength(1);

    await app.close();
  });
});
