FROM oven/bun:1.3.5-debian AS build

WORKDIR /src

COPY package.json bun.lock turbo.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY README.md ./README.md
COPY .ruler ./.ruler
COPY AGENTS.md ./AGENTS.md

RUN bun install --frozen-lockfile
RUN mkdir -p packages/cli/node_modules \
  && rm -rf packages/cli/node_modules/clipanion packages/cli/node_modules/dotenv packages/cli/node_modules/picocolors \
  && ln -s ../../../node_modules/clipanion packages/cli/node_modules/clipanion \
  && ln -s ../../../node_modules/dotenv packages/cli/node_modules/dotenv \
  && ln -s ../../../node_modules/picocolors packages/cli/node_modules/picocolors
RUN bun run --cwd apps/web build
RUN bun build --compile --minify --sourcemap packages/cli/src/index.ts --outfile hive

FROM debian:12-slim AS runtime

ARG TARGETPLATFORM

ENV HIVE_HOME=/home/hive/.hive \
    HIVE_INSTANCE_MODE=private-remote \
    HIVE_DEPLOYMENT_KIND=docker-compose \
    HIVE_REMOTE_ACCESS_ACK=private-network-only \
    HIVE_ALLOWED_WORKSPACE_ROOTS=/workspaces \
    HIVE_BROWSE_ROOT=/workspaces \
    HIVE_INTERNAL_API_URL=http://127.0.0.1:3000 \
    HOST=0.0.0.0 \
    PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssh-client \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash hive \
  && mkdir -p /opt/hive /workspaces /home/hive/.hive/state \
  && chown -R hive:hive /opt/hive /workspaces /home/hive

COPY --from=build /src/hive /opt/hive/current/hive
COPY --from=build /src/apps/web/dist /opt/hive/current/public
COPY --from=build /src/apps/server/src/migrations /opt/hive/current/migrations

RUN ln -s /opt/hive/current/hive /usr/local/bin/hive \
  && chown -R hive:hive /opt/hive

USER hive
WORKDIR /workspaces

RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path || true

ENV PATH=/home/hive/.opencode/bin:${PATH} \
    HIVE_WEB_DIST=/opt/hive/current/public \
    HIVE_MIGRATIONS_DIR=/opt/hive/current/migrations \
    DATABASE_URL=/home/hive/.hive/state/hive.db

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1

CMD ["hive", "--foreground"]
