#!/bin/sh
set -e
pnpm --filter @znurznurznur/extended-maci-crypto build
pnpm --filter @znurznurznur/extended-maci-domainobjs build
pnpm --filter @znurznurznur/extended-maci-core build
pnpm --filter @znurznurznur/extended-maci-contracts build
pnpm --filter @znurznurznur/extended-maci-sdk build
cd apps/zugov-frontend && npx vite build
