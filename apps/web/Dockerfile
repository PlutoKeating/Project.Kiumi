ARG NPM_REGISTRY=https://registry.npmjs.org
FROM node:24-alpine AS build
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
RUN pnpm install --frozen-lockfile --filter @kiumi/web...
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN pnpm --filter @kiumi/web build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
