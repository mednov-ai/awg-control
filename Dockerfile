# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.mjs ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps ./apps
RUN pnpm --filter @awg-control/contracts build \
 && pnpm --filter @awg-control/api build \
 && pnpm --filter @awg-control/web build \
 && pnpm --filter @awg-control/api deploy --prod --legacy /runtime

FROM node:24-bookworm-slim AS panel
ENV NODE_ENV=production \
    AWG_CONTROL_HOST=127.0.0.1 \
    AWG_CONTROL_PORT=8080 \
    AWG_CONTROL_DATABASE=/var/lib/awg-control/awg-control.db \
    AWG_CONTROL_MASTER_KEY_FILE=/run/secrets/awg-control-master-key \
    AWG_CONTROL_MIGRATIONS=/app/migrations \
    AWG_CONTROL_WEB_ROOT=/app/web
WORKDIR /app
RUN groupadd --gid 10001 awg-control \
 && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin awg-control \
 && mkdir -p /var/lib/awg-control /app/web /app/migrations \
 && chown -R 10001:10001 /var/lib/awg-control
COPY --from=build --chown=10001:10001 /runtime/ /app/
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist/ /app/web/
COPY --from=build --chown=10001:10001 /workspace/apps/api/migrations/ /app/migrations/
USER 10001:10001
EXPOSE 8080
VOLUME ["/var/lib/awg-control"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node"]
CMD ["dist/main.js"]
