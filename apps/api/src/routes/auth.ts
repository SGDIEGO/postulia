import type { FastifyInstance } from "fastify";
import {
  TOKEN_TTL,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  type AuthSession,
} from "@postulia/shared";
import { badRequest, conflict, forbidden, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { generateRefreshToken, hashToken } from "../lib/tokens.js";
import { toUserProfile } from "../mappers.js";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  async function issueSession(user: SessionUser, userAgent?: string): Promise<AuthSession> {
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
    const refreshToken = generateRefreshToken();

    await app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL.refreshTokenMs),
        userAgent: userAgent ?? null,
      },
    });

    return {
      user: toUserProfile(user),
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + TOKEN_TTL.accessTokenMs).toISOString(),
    };
  }

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      if (!app.env.ALLOW_REGISTRATION) {
        throw forbidden("El registro está deshabilitado en este servidor");
      }

      const parsed = registerInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const email = parsed.data.email.trim().toLowerCase();
      const existing = await app.prisma.user.findUnique({ where: { email } });
      if (existing) throw conflict("Ya existe una cuenta con ese correo");

      const user = await app.prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(parsed.data.password),
          name: parsed.data.name?.trim() ?? null,
        },
      });

      reply.code(201);
      return issueSession(user, request.headers["user-agent"]);
    },
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request) => {
      const parsed = loginInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const email = parsed.data.email.trim().toLowerCase();
      const user = await app.prisma.user.findUnique({ where: { email } });
      const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
      if (!user || !valid) throw unauthorized("Correo o contraseña incorrectos");

      return issueSession(user, request.headers["user-agent"]);
    },
  );

  app.post(
    "/api/auth/refresh",
    { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (request) => {
      const parsed = refreshInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const tokenHash = hashToken(parsed.data.refreshToken);
      const stored = await app.prisma.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
        throw unauthorized("Sesión expirada, inicia sesión de nuevo");
      }

      // Rotación: el token usado se revoca y se emite uno nuevo.
      await app.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      return issueSession(stored.user, request.headers["user-agent"]);
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const parsed = refreshInputSchema.safeParse(request.body);
    if (parsed.success) {
      await app.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(parsed.data.refreshToken) },
        data: { revokedAt: new Date() },
      });
    }
    reply.code(204);
    return null;
  });

  app.get("/api/me", { preHandler: app.authenticate }, async (request) => {
    const user = await app.prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw unauthorized("Usuario no encontrado");
    return toUserProfile(user);
  });
}
