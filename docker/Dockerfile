# syntax=docker/dockerfile:1

# ---------- Etapa de compilación ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Solo se instalan los workspaces necesarios para el API (sin la extensión).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma

RUN npm ci --workspace @postulia/api --workspace @postulia/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @postulia/shared \
  && npm run build -w @postulia/api

# ---------- Etapa de migraciones (temporal, se ejecuta antes del API) ----------
FROM build AS migrate
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"]

# ---------- Etapa de ejecución ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Dependencias de producción. El cliente de Prisma se copia ya generado desde
# la etapa de compilación, por eso no se ejecutan scripts aquí.
RUN npm ci --omit=dev --ignore-scripts \
    --workspace @postulia/api --workspace @postulia/shared --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
