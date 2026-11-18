import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type {
  ApplicationSync,
  AuthSession,
  RegisterResult,
  SyncPushResult,
  VerificationStatus,
} from "@postulia/shared";
import { buildApp } from "./app.js";
import type { Env } from "./env.js";
import { createFakePrisma } from "./testing/fake-prisma.js";

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

// Nodemailer nunca sale a la red en las pruebas.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: sendMailMock,
      close: () => undefined,
    }),
  },
}));

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
  PUBLIC_URL: "http://localhost:3000",
  EMAIL_VERIFICATION_TTL_MINUTES: 30,
  REQUIRE_EMAIL_VERIFICATION: true,
  SMTP_HOST: "smtp.test.local",
  SMTP_PORT: 587,
  SMTP_SECURE: "false",
  SMTP_USER: "test@test.local",
  SMTP_PASS: "test-pass",
  SMTP_FROM: "Test <test@test.local>",
  GEMINI_MODEL: "gemini-2.5-flash",
};

afterEach(() => {
  sendMailMock.mockClear();
});

async function setupWithPrisma(overrides: Partial<Env> = {}) {
  const prisma = createFakePrisma();
  const app = await buildApp({
    env: { ...testEnv, ...overrides },
    prisma: prisma as unknown as PrismaClient,
    logger: false,
  });
  await app.ready();
  return { app, prisma };
}

async function setup() {
  return (await setupWithPrisma()).app;
}

/** Token del enlace del último correo de verificación enviado. */
function lastVerificationToken(): string {
  const call = sendMailMock.mock.calls.at(-1)?.[0] as { text?: string } | undefined;
  const match = /token=([A-Za-z0-9_-]+)/.exec(call?.text ?? "");
  if (!match) throw new Error("El correo de verificación no contiene un token");
  return match[1] ?? "";
}

async function registerRaw(
  app: Awaited<ReturnType<typeof setup>>,
  email = "diego@example.com",
): Promise<RegisterResult> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "contrasena-larga-123", name: "Diego" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<RegisterResult>();
}

/** Registra y confirma el correo para obtener una sesión real. */
async function register(
  app: Awaited<ReturnType<typeof setup>>,
  email = "diego@example.com",
): Promise<AuthSession> {
  const result = await registerRaw(app, email);
  if ("accessToken" in result) return result;

  const link = await app.inject({
    method: "GET",
    url: `/api/auth/verify-email?token=${encodeURIComponent(lastVerificationToken())}`,
    headers: { accept: "application/json" },
  });
  expect(link.json()).toMatchObject({ status: "verified" });

  const status = await app.inject({
    method: "POST",
    url: "/api/auth/verify-email/status",
    payload: { token: result.verificationToken },
  });
  expect(status.statusCode).toBe(200);
  const body = status.json<VerificationStatus>();
  if (!body.session) throw new Error("La verificación no emitió sesión");
  return body.session;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("correo con IA", () => {
  const userApiKey = "clave-gemini-del-usuario";

  async function setupWithUser(email = "ia@example.com") {
    const prisma = createFakePrisma();
    const app = await buildApp({
      env: testEnv,
      prisma: prisma as unknown as PrismaClient,
      logger: false,
    });
    await app.ready();
    const session = await register(app, email);

    await prisma.userCv.create({
      data: {
        userId: session.user.id,
        fileName: "cv.pdf",
        filePath: "/tmp/cv.pdf",
        text: "Experiencia en TypeScript, React y PostgreSQL.",
      },
    });

    return { app, prisma, session };
  }

  it("guarda la API key de IA cifrada y no la devuelve", async () => {
    const { app, prisma, session } = await setupWithUser();

    const response = await app.inject({
      method: "PUT",
      url: "/api/users/ia-config",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { provider: "gemini", apiKey: userApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "gemini", model: null, configured: true });

    const stored = await prisma.user.findUnique({ where: { id: session.user.id } });
    expect(stored?.iaProvider).toBe("gemini");
    expect(stored?.iaApiKey).toBeTruthy();
    expect(stored?.iaApiKey).not.toContain(userApiKey);

    await app.close();
  });

  it("guarda el modelo del usuario sin el prefijo models/ y lo devuelve en ia-config", async () => {
    const { app, session } = await setupWithUser();

    const response = await app.inject({
      method: "PUT",
      url: "/api/users/ia-config",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { provider: "gemini", apiKey: userApiKey, model: "models/gemini-2.5-pro" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
      configured: true,
    });

    const config = await app.inject({
      method: "GET",
      url: "/api/users/ia-config",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
      configured: true,
    });
    expect(JSON.stringify(config.json())).not.toContain(userApiKey);

    await app.close();
  });

  it("lista los modelos de Gemini con la API key del usuario y filtra generateContent", async () => {
    const { app, session } = await setupWithUser();

    await app.inject({
      method: "PUT",
      url: "/api/users/ia-config",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { provider: "gemini", apiKey: userApiKey },
    });

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              description: "Modelo Pro",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            {
              name: "models/text-embedding-004",
              displayName: "Embedding",
              description: "No genera texto",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "GET",
      url: "/api/users/ia-models",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [
        {
          id: "gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          description: "Modelo Pro",
        },
      ],
      defaultModel: "gemini-2.5-flash",
      configured: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/v1beta/models");
    expect(init.headers).toMatchObject({ "X-goog-api-key": userApiKey });

    await app.close();
  });

  it("devuelve una lista vacía de modelos si el usuario no tiene API key", async () => {
    const { app, session } = await setupWithUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "GET",
      url: "/api/users/ia-models",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [],
      defaultModel: "gemini-2.5-flash",
      configured: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("falla sin API key del usuario en lugar de usar una clave del servidor", async () => {
    const { app, session } = await setupWithUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ia/draft-email",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { text: "Buscamos desarrollador. Escribe a rrhh@acme.test" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("API key");
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("genera un borrador con la API key del usuario y no envía correo", async () => {
    const { app, session } = await setupWithUser();

    const config = await app.inject({
      method: "PUT",
      url: "/api/users/ia-config",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { provider: "gemini", apiKey: userApiKey, model: "gemini-2.5-pro" },
    });
    expect(config.statusCode).toBe(200);

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      to: "rrhh@acme.test",
                      subject: "Postulación junior",
                      body: "Hola, me interesa la oportunidad.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ia/draft-email",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        text: "Buscamos desarrollador junior. Escribe a rrhh@acme.test",
        to: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      to: "rrhh@acme.test",
      subject: "Postulación junior",
      body: "Hola, me interesa la oportunidad.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("/models/gemini-2.5-pro:generateContent");
    expect(init.headers).toMatchObject({ "X-goog-api-key": userApiKey });
    expect(String(init.body)).toContain("Experiencia en TypeScript");

    await app.close();
  });

  it("rechaza el envío revisado inválido sin llamar a Gemini", async () => {
    const { app, session } = await setupWithUser();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: "/api/ia/send-email",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { to: "no-es-un-correo", subject: "", body: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("envía el correo revisado con el SMTP global y el remitente configurado", async () => {
    const { app, session } = await setupWithUser("envio@example.com");
    sendMailMock.mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/api/ia/send-email",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { to: "reclutador@example.com", subject: "Postulación", body: "Hola" },
    });

    expect(response.statusCode).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const mail = sendMailMock.mock.calls[0]?.[0] as { to: string; from: string; subject: string };
    expect(mail.to).toBe("reclutador@example.com");
    expect(mail.from).toBe("Test <test@test.local>");
    expect(mail.subject).toBe("Postulación");

    await app.close();
  });

  it("responde 503 cuando el servidor no tiene SMTP configurado", async () => {
    const prisma = createFakePrisma();
    const app = await buildApp({
      env: {
        ...testEnv,
        REQUIRE_EMAIL_VERIFICATION: false,
        SMTP_HOST: undefined,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
      },
      prisma: prisma as unknown as PrismaClient,
      logger: false,
    });
    await app.ready();

    const session = await register(app, "sin-smtp-ia@example.com");
    await prisma.userCv.create({
      data: { userId: session.user.id, fileName: "cv.pdf", filePath: "/tmp/cv.pdf" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ia/send-email",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { to: "reclutador@example.com", subject: "Postulación", body: "Hola" },
    });

    expect(response.statusCode).toBe(503);
    expect(sendMailMock).not.toHaveBeenCalled();

    await app.close();
  });
});

describe("verificación de correo", () => {
  it("el registro no inicia sesión hasta confirmar el correo", async () => {
    const app = await setup();
    const result = await registerRaw(app);

    expect(result).toMatchObject({
      status: "verification_sent",
      email: "diego@example.com",
      expiresInMinutes: 30,
    });
    expect("accessToken" in result).toBe(false);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const mail = sendMailMock.mock.calls[0]?.[0] as { to: string; text: string };
    expect(mail.to).toBe("diego@example.com");
    expect(mail.text).toContain("/api/auth/verify-email?token=");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "diego@example.com", password: "contrasena-larga-123" },
    });
    expect(login.statusCode).toBe(403);
    const body = login.json();
    expect(body.error).toBe("email_not_verified");
    expect(body.details.verificationToken).toBeTruthy();
    expect(body.details.expiresAt).toBeTruthy();

    await app.close();
  });

  it("confirma el correo y emite la sesión una sola vez", async () => {
    const app = await setup();
    const result = await registerRaw(app);
    if ("accessToken" in result) throw new Error("Se esperaba una verificación pendiente");
    const token = lastVerificationToken();

    const page = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    });
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Correo confirmado");

    const again = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
      headers: { accept: "application/json" },
    });
    expect(again.json()).toEqual({ status: "already" });

    const status = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email/status",
      payload: { token: result.verificationToken },
    });
    const payload = status.json<VerificationStatus>();
    expect(payload.status).toBe("verified");
    expect(payload.session?.user.email).toBe("diego@example.com");

    await app.close();
  });

  it("rechaza un enlace caducado sin activar la cuenta", async () => {
    const { app, prisma } = await setupWithPrisma();
    const result = await registerRaw(app);
    if ("accessToken" in result) throw new Error("Se esperaba una verificación pendiente");

    const row = await prisma.emailVerification.findFirst({});
    await prisma.emailVerification.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(lastVerificationToken())}`,
      headers: { accept: "application/json" },
    });
    expect(expired.json()).toEqual({ status: "expired" });

    const status = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email/status",
      payload: { token: result.verificationToken },
    });
    expect(status.json()).toMatchObject({ status: "expired" });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "diego@example.com", password: "contrasena-larga-123" },
    });
    expect(login.statusCode).toBe(403);

    await app.close();
  });

  it("reenvía, invalida el enlace anterior y respeta el cooldown", async () => {
    const { app, prisma } = await setupWithPrisma();
    const result = await registerRaw(app);
    if ("accessToken" in result) throw new Error("Se esperaba una verificación pendiente");
    const oldToken = lastVerificationToken();

    const tooSoon = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email/resend",
      payload: { token: result.verificationToken },
    });
    expect(tooSoon.statusCode).toBe(429);

    const row = await prisma.emailVerification.findFirst({});
    await prisma.emailVerification.update({
      where: { id: row.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });

    const resend = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email/resend",
      payload: { token: result.verificationToken },
    });
    expect(resend.statusCode).toBe(200);
    const resent = resend.json<{ verificationToken: string }>();
    expect(resent.verificationToken).not.toBe(result.verificationToken);

    const oldLink = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(oldToken)}`,
      headers: { accept: "application/json" },
    });
    expect(oldLink.json()).toEqual({ status: "invalid" });

    const newLink = await app.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${encodeURIComponent(lastVerificationToken())}`,
      headers: { accept: "application/json" },
    });
    expect(newLink.json()).toEqual({ status: "verified" });

    await app.close();
  });

  it("no permite registrarse sin SMTP configurado", async () => {
    const { app } = await setupWithPrisma({
      SMTP_HOST: undefined,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "sin-smtp@example.com", password: "contrasena-larga-123" },
    });

    expect(response.statusCode).toBe(503);
    expect(sendMailMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("informa en /health si el correo está configurado", async () => {
    const { app } = await setupWithPrisma();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toMatchObject({ status: "ok", mail: "configured" });
    await app.close();
  });
});

describe("preferencias del usuario", () => {
  it("devuelve valores por defecto y crea la fila si falta", async () => {
    const app = await setup();
    const session = await register(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/users/settings",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      syncEnabled: true,
      notificationsEnabled: true,
      emailNotificationsEnabled: true,
      followUpDays: 7,
    });

    await app.close();
  });

  it("persiste los cambios y los devuelve en la siguiente consulta", async () => {
    const app = await setup();
    const session = await register(app);
    const headers = { authorization: `Bearer ${session.accessToken}` };

    const update = await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { syncEnabled: false, notificationsEnabled: false, followUpDays: 14 },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({
      syncEnabled: false,
      notificationsEnabled: false,
      emailNotificationsEnabled: true,
      followUpDays: 14,
    });

    const read = await app.inject({ method: "GET", url: "/api/users/settings", headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({
      syncEnabled: false,
      notificationsEnabled: false,
      emailNotificationsEnabled: true,
      followUpDays: 14,
    });

    await app.close();
  });

  it("permite actualizaciones parciales sin borrar el resto", async () => {
    const app = await setup();
    const session = await register(app);
    const headers = { authorization: `Bearer ${session.accessToken}` };

    await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { followUpDays: 21 },
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { notificationsEnabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      syncEnabled: true,
      notificationsEnabled: false,
      emailNotificationsEnabled: true,
      followUpDays: 21,
    });

    await app.close();
  });

  it("rechaza días de seguimiento fuera de rango", async () => {
    const app = await setup();
    const session = await register(app);
    const headers = { authorization: `Bearer ${session.accessToken}` };

    const tooLow = await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { followUpDays: 0 },
    });
    expect(tooLow.statusCode).toBe(400);

    const tooHigh = await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { followUpDays: 366 },
    });
    expect(tooHigh.statusCode).toBe(400);

    const fractional = await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers,
      payload: { followUpDays: 7.5 },
    });
    expect(fractional.statusCode).toBe(400);

    await app.close();
  });

  it("requiere sesión y aísla las preferencias entre usuarios", async () => {
    const app = await setup();
    const first = await register(app, "uno@example.com");
    const second = await register(app, "dos@example.com");

    const anonymous = await app.inject({ method: "GET", url: "/api/users/settings" });
    expect(anonymous.statusCode).toBe(401);

    await app.inject({
      method: "PUT",
      url: "/api/users/settings",
      headers: { authorization: `Bearer ${first.accessToken}` },
      payload: { followUpDays: 3, syncEnabled: false },
    });

    const other = await app.inject({
      method: "GET",
      url: "/api/users/settings",
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(other.json()).toEqual({
      syncEnabled: true,
      notificationsEnabled: true,
      emailNotificationsEnabled: true,
      followUpDays: 7,
    });

    await app.close();
  });
});
