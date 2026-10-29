ARG NPM_REGISTRY=https://registry.npmjs.org
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && npm config set registry $NPM_REGISTRY

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/catalog/package.json packages/catalog/
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @kiumi/server...

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server

ENV KIUMI_DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
CMD ["node", "apps/server/src/index.ts"]
