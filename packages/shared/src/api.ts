import { z } from "zod";

export const registerInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(200),
  name: z.string().trim().min(1).max(120).optional(),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(10).max(2000),
});

export type RefreshInput = z.infer<typeof refreshInputSchema>;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface AuthSession {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

/** Tiempos de vida de los tokens. */
export const TOKEN_TTL = {
  accessToken: "30m",
  accessTokenMs: 30 * 60 * 1000,
  refreshToken: "60d",
  refreshTokenMs: 60 * 24 * 60 * 60 * 1000,
} as const;
