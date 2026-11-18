import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashToken } from "./tokens.js";

/** Tokens nuevos y sus hashes. El texto plano solo viaja una vez. */
export function newVerificationTokens(): {
  token: string;
  clientToken: string;
  tokenHash: string;
  clientHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  const clientToken = randomBytes(32).toString("base64url");
  return {
    token,
    clientToken,
    tokenHash: hashToken(token),
    clientHash: hashToken(clientToken),
  };
}

export async function createEmailVerification(
  prisma: PrismaClient,
  userId: string,
  ttlMinutes: number,
): Promise<{ token: string; clientToken: string; expiresAt: Date; id: string }> {
  // Un solo enlace vivo por cuenta: pedir otro invalida el anterior.
  await prisma.emailVerification.deleteMany({ where: { userId, verifiedAt: null } });

  const { token, clientToken, tokenHash, clientHash } = newVerificationTokens();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const row = await prisma.emailVerification.create({
    data: { userId, tokenHash, clientHash, expiresAt },
  });

  return { token, clientToken, expiresAt, id: row.id };
}

/** Busca por el token del enlace del correo. */
export function findVerificationByEmailToken(prisma: PrismaClient, token: string) {
  return prisma.emailVerification.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
}

/** Busca por el token que maneja la extensión. */
export function findVerificationByClientToken(prisma: PrismaClient, clientToken: string) {
  return prisma.emailVerification.findUnique({
    where: { clientHash: hashToken(clientToken) },
    include: { user: true },
  });
}

/**
 * Rota el token de cliente de la verificación pendiente de una cuenta. Se usa
 * al iniciar sesión sin haber verificado: la extensión necesita un token con
 * el que consultar el estado sin volver a escribir la contraseña.
 */
export async function rotateClientToken(
  prisma: PrismaClient,
  verificationId: string,
): Promise<string> {
  const clientToken = randomBytes(32).toString("base64url");
  await prisma.emailVerification.update({
    where: { id: verificationId },
    data: { clientHash: hashToken(clientToken) },
  });
  return clientToken;
}
