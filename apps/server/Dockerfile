# Build context is the repo root (this is a pnpm workspace, not a
# standalone package), e.g. `docker build -f apps/server/Dockerfile .`

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
# prisma generate (a postinstall script) just needs DATABASE_URL to resolve
# when loading prisma.config.ts — it doesn't connect to it. The real value
# is supplied at runtime via docker-compose.
ENV DATABASE_URL="postgresql://user:pass@build-time-placeholder:5432/db"
RUN pnpm install --frozen-lockfile
RUN pnpm --filter server build
RUN pnpm --filter server deploy --prod /prod/server
# pnpm deploy's own postinstall-triggered `prisma generate` doesn't reliably
# land in the deployed node_modules (pnpm's content-addressable store /
# hardlink layout for `deploy` seems to lose it) — regenerate explicitly
# straight into /prod/server to be sure the client is actually there.
RUN cd /prod/server && node_modules/.bin/prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/server ./
# `pnpm deploy` follows the package's .gitignore, which excludes dist/;
# copy the actual build output on top to make sure it's there.
COPY --from=build /repo/apps/server/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
