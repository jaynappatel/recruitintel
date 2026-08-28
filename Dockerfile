# M15 production web image. Build workers separately so web credentials cannot
# imply worker privileges.
FROM node:20.19-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @recruitintel/web build

FROM node:20.19-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app /app
EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "@recruitintel/web", "start"]
