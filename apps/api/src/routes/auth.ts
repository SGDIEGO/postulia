import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  TOKEN_TTL,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  verificationTokenInputSchema,
  type AuthSession,
  type RegisterResult,
  type VerificationStatus,
} from "@postulia/shared";
import {
  HttpError,
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { generateRefreshToken, hashToken } from "../lib/tokens.js";
import {
  isMailConfigured,
  publicBaseUrl,
  sendMail,
  verificationEmail,
} from "../lib/mailer.js";
import {
  createEmailVerification,
  findVerificationByClientToken,
  findVerificationByEmailToken,
  rotateClientToken,
} from "../lib/verification.js";
import { verificationPage, type VerificationPageState } from "../lib/verification-page.js";
import { toUserProfile } from "../mappers.js";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

interface UnverifiedUser extends SessionUser {
  emailVerifiedAt: Date | null;
}

const RESEND_COOLDOWN_MS = 60_000;

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

  function requestBaseUrl(request: FastifyRequest): string {
    return publicBaseUrl(app.env, `${request.protocol}://${request.host}`);
  }

  function verificationLink(request: FastifyRequest, token: string): string {
    return `${requestBaseUrl(request)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  }

  async function deliverVerificationEmail(
    request: FastifyRequest,
    user: { email: string; name: string | null },
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    const content = verificationEmail({
      name: user.name,
      link: verificationLink(request, token),
      expiresAt,
      ttlMinutes: app.env.EMAIL_VERIFICATION_TTL_MINUTES,
    });

    await sendMail(app.env, {
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  /**
   * Al iniciar sesión sin verificar, la extensión necesita un token de cliente
   * para sondear el estado. Rota el de la verificación pendiente (o crea una).
   */
  async function challengeForUnverified(
    request: FastifyRequest,
    user: UnverifiedUser,
  ): Promise<{ email: string; verificationToken: string; expiresAt: string }> {
    const pending = await app.prisma.emailVerification.findFirst({
      where: { userId: user.id, verifiedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (pending) {
      const clientToken = await rotateClientToken(app.prisma, pending.id);
      return {
        email: user.email,
        verificationToken: clientToken,
        expiresAt: pending.expiresAt.toISOString(),
      };
    }

    const created = await createEmailVerification(
      app.prisma,
      user.id,
      app.env.EMAIL_VERIFICATION_TTL_MINUTES,
    );
    try {
      await deliverVerificationEmail(request, user, created.token, created.expiresAt);
    } catch (error) {
      // No bloqueamos el inicio de sesión: la UI ofrece reenviar el correo.
      request.log.warn({ err: error }, "No se pudo enviar el correo de verificación");
    }

    return {
      email: user.email,
      verificationToken: created.clientToken,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply): Promise<RegisterResult> => {
      if (!app.env.ALLOW_REGISTRATION) {
        throw forbidden("El registro está deshabilitado en este servidor");
      }

      const parsed = registerInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const email = parsed.data.email.trim().toLowerCase();
      const requiresVerification = app.env.REQUIRE_EMAIL_VERIFICATION;

      if (requiresVerification && !isMailConfigured(app.env)) {
        throw serviceUnavailable(
          "El servidor no puede enviar correos de confirmación. Avisa al administrador.",
        );
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const name = parsed.data.name?.trim() ?? null;
      const existing = await app.prisma.user.findUnique({ where: { email } });

      if (existing?.emailVerifiedAt) {
        throw conflict("Ya existe una cuenta con ese correo");
      }

      // Cuenta creada pero nunca confirmada: se permite reintentar el registro
      // (y así se recupera de un envío de correo fallido).
      const user = existing
        ? await app.prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash, name },
          })
        : await app.prisma.user.create({ data: { email, passwordHash, name } });

      reply.code(201);

      if (!requiresVerification) {
        return issueSession(user, request.headers["user-agent"]);
      }

      const created = await createEmailVerification(
        app.prisma,
        user.id,
        app.env.EMAIL_VERIFICATION_TTL_MINUTES,
      );

      try {
        await deliverVerificationEmail(request, user, created.token, created.expiresAt);
      } catch (error) {
        request.log.error({ err: error }, "No se pudo enviar el correo de verificación");
        throw badGateway(
          "No se pudo enviar el correo de confirmación. Inténtalo de nuevo en unos minutos.",
        );
      }

      return {
        status: "verification_sent",
        email: user.email,
        verificationToken: created.clientToken,
        expiresAt: created.expiresAt.toISOString(),
        expiresInMinutes: app.env.EMAIL_VERIFICATION_TTL_MINUTES,
      };
    },
  );

  /**
   * Enlace del correo. Devuelve HTML para el navegador y JSON si se pide
   * explícitamente con Accept: application/json (pruebas y futuros deep links).
   */
  app.get(
    "/api/auth/verify-email",
    { config: { rateLimit: { max: 120, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const token = (request.query as { token?: string }).token ?? "";
      const wantsJson = String(request.headers.accept ?? "").includes("application/json");

      const finish = (state: VerificationPageState) => {
        if (wantsJson) return reply.send({ status: state });
        return reply
          .header("cache-control", "no-store")
          .header("referrer-policy", "no-referrer")
          .type("text/html; charset=utf-8")
          .send(verificationPage(state));
      };

      if (!token) return finish("invalid");

      const verification = await findVerificationByEmailToken(app.prisma, token);
      if (!verification) return finish("invalid");
      if (verification.verifiedAt || verification.user.emailVerifiedAt) return finish("already");
      if (verification.expiresAt.getTime() < Date.now()) return finish("expired");

      const now = new Date();
      await app.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { verifiedAt: now },
      });
      await app.prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerifiedAt: now },
      });

      request.log.info({ userId: verification.userId }, "Correo verificado");
      return finish("verified");
    },
  );

  /**
   * Sondeo de la extensión. Emite la sesión una sola vez confirmado el correo
   * (con una ventana de 10 minutos para reintentos de red).
   */
  app.post(
    "/api/auth/verify-email/status",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request): Promise<VerificationStatus> => {
      const parsed = verificationTokenInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const verification = await findVerificationByClientToken(app.prisma, parsed.data.token);
      if (!verification) throw notFound("Verificación no encontrada");

      const base = {
        email: verification.user.email,
        verificationToken: parsed.data.token,
        expiresAt: verification.expiresAt.toISOString(),
      };

      if (!verification.user.emailVerifiedAt) {
        const expired = verification.expiresAt.getTime() < Date.now();
        return { ...base, status: expired ? "expired" : "pending" };
      }

      const issuedAt = verification.sessionIssuedAt?.getTime() ?? 0;
      const canIssue = !issuedAt || Date.now() - issuedAt < 10 * 60_000;
      if (!canIssue) return { ...base, status: "verified" };

      const session = await issueSession(verification.user, request.headers["user-agent"]);
      await app.prisma.emailVerification.update({
        where: { id: verification.id },
        data: { sessionIssuedAt: new Date() },
      });

      return { ...base, status: "verified", session };
    },
  );

  app.post(
    "/api/auth/verify-email/resend",
    { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } },
    async (request) => {
      const parsed = verificationTokenInputSchema.safeParse(request.body);
      if (!parsed.success) throw badRequest("Datos inválidos", parsed.error.issues);

      const verification = await findVerificationByClientToken(app.prisma, parsed.data.token);
      if (!verification) throw notFound("Verificación no encontrada");

      const base = {
        email: verification.user.email,
        verificationToken: parsed.data.token,
        expiresAt: verification.expiresAt.toISOString(),
      };

      if (verification.user.emailVerifiedAt) {
        return { ...base, status: "verified" as const };
      }
      if (!isMailConfigured(app.env)) {
        throw serviceUnavailable("El servidor no puede enviar correos en este momento.");
      }
      if (Date.now() - verification.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        throw tooManyRequests("Espera un minuto antes de pedir otro correo.");
      }

      const created = await createEmailVerification(
        app.prisma,
        verification.userId,
        app.env.EMAIL_VERIFICATION_TTL_MINUTES,
      );

      try {
        await deliverVerificationEmail(
          request,
          verification.user,
          created.token,
          created.expiresAt,
        );
      } catch (error) {
        request.log.error({ err: error }, "No se pudo reenviar el correo de verificación");
        throw badGateway("No se pudo reenviar el correo. Inténtalo de nuevo en unos minutos.");
      }

      return {
        status: "verification_sent" as const,
        email: verification.user.email,
        verificationToken: created.clientToken,
        expiresAt: created.expiresAt.toISOString(),
        expiresInMinutes: app.env.EMAIL_VERIFICATION_TTL_MINUTES,
      };
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

      if (app.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
        const challenge = await challengeForUnverified(request, user);
        throw new HttpError(
          403,
          "email_not_verified",
          "Confirma tu correo para activar la cuenta. Revisa tu bandeja de entrada.",
          challenge,
        );
      }

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
