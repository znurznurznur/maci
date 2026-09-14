# syntax=docker/dockerfile:1
# Build context must be the monorepo root (apps/zugov-backend has no
# workspace:* dependencies, but the install step still needs the root
# lockfile/workspace manifest to resolve via pnpm).
FROM node:22-alpine AS base
# The root package.json pins packageManager to pnpm@9.15.9 (for local dev/CI), which
# Corepack honors over the `prepare --activate` version below unless project-spec
# resolution is disabled — otherwise this build silently runs pnpm 9, which doesn't
# have the --legacy deploy flag used further down (see run 32140065143).
ENV COREPACK_ENABLE_PROJECT_SPEC=0
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
# The workspace root pins engines.node=20 for its Hardhat/circuits tooling, which this
# app (engines.node>=22) doesn't use — bypass pnpm's engine check rather than lowering
# the Node version this image builds/runs with.
ENV PNPM_CONFIG_ENGINE_STRICT=false
WORKDIR /repo

FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/zugov-backend/package.json apps/zugov-backend/package.json
COPY apps/subgraph/package.json apps/subgraph/package.json
# Neither @zugov/backend nor @znurznurznur/extended-maci-subgraph has a workspace:* dependency, so
# these three manifests are all pnpm needs to resolve the filtered install below.
# The cache mount persists pnpm's downloaded-package store across builds, independent of
# whether this layer itself is a Docker cache hit — without it, any lockfile change (routine)
# forces every dependency to be re-fetched from the registry from scratch every deploy, even
# ones already downloaded in a previous build. See ENGINEERING.md's Decisions Log.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @zugov/backend... --filter @znurznurznur/extended-maci-subgraph...

# Backend and subgraph both branch from `deps` (not from each other) so BuildKit builds
# them concurrently, and a source change in one no longer busts the other's build cache.
FROM deps AS backend-build

COPY apps/zugov-backend apps/zugov-backend
RUN pnpm --filter @zugov/backend run build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @zugov/backend deploy --prod --legacy /prod/backend

FROM deps AS subgraph-build

# The per-community subgraph deploy pipeline (graph-cli, mustache, the
# AssemblyScript compiler) runs from inside this same container — bundled as
# its own self-contained package (not merged into the backend's node_modules)
# since it isn't a dependency of @zugov/backend. Not --prod: graph-cli's
# codegen/deploy commands need the AssemblyScript compiler, which is a
# devDependency here.
COPY apps/subgraph apps/subgraph
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @znurznurznur/extended-maci-subgraph deploy --legacy /prod/subgraph

FROM node:22-alpine AS runtime
# pnpm stays in the runtime image: apps/zugov-backend/src/services/subgraphDeployService.ts
# shells out to apps/subgraph/scripts/deploy-community.mjs, which itself runs
# `pnpm exec graph ...` on every per-community subgraph deploy request — not just at
# build time.
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-build /prod/backend/node_modules ./node_modules
COPY --from=backend-build /prod/backend/package.json ./package.json
COPY --from=backend-build /repo/apps/zugov-backend/dist ./dist
COPY --from=backend-build /repo/apps/zugov-backend/drizzle ./drizzle
COPY --from=backend-build /repo/apps/zugov-backend/drizzle.config.ts ./drizzle.config.ts
COPY --from=subgraph-build /prod/subgraph ./subgraph

EXPOSE 3001
CMD ["node", "dist/index.js"]
