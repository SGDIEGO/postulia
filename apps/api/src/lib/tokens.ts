import { createHash, randomBytes } from "node:crypto";

/** Token opaco de refresco (se guarda hasheado en la base de datos). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
