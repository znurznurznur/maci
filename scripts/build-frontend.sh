#!/bin/sh
set -e
pnpm --filter @extended-maci/crypto build
pnpm --filter @extended-maci/domainobjs build
pnpm --filter @extended-maci/core build
pnpm --filter @extended-maci/contracts build
pnpm --filter @extended-maci/sdk build
cd apps/zugov-frontend && npx vite build
