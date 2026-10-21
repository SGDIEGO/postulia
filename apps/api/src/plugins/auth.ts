import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TOKEN_TTL } from "@postulia/shared";
import { unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export interface AuthPluginOptions {
  secret: string;
}

export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  await app.register(jwt, {
    secret: options.secret,
    sign: { expiresIn: TOKEN_TTL.accessToken },
  });

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized("Token inválido o expirado");
    }
    if (!request.user?.sub) {
      throw unauthorized("Token inválido o expirado");
    }
  });
});
