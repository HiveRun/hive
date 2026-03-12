#!/usr/bin/env bash

set -euo pipefail

eval "$(bun run scripts/dev/dev-ports.ts --shell)"

HIVE_HOME="${HIVE_HOME:-$(pwd)/.hive}"
HIVE_STATE_DIR="${HIVE_STATE_DIR:-${HIVE_HOME}/state}"
HIVE_ELIXIR_DATABASE_PATH="${HIVE_ELIXIR_DATABASE_PATH:-${HIVE_STATE_DIR}/hive_server_elixir_dev.db}"
DATABASE_PATH="${DATABASE_PATH:-${HIVE_ELIXIR_DATABASE_PATH}}"

mkdir -p "${HIVE_STATE_DIR}"

echo "[hive:dev] web port: ${FRONTEND_PORT}"
echo "[hive:dev] api port: ${BACKEND_PORT}"
echo "[hive:dev] api url: ${BACKEND_URL}"
echo "[hive:dev] db path: ${HIVE_ELIXIR_DATABASE_PATH}"

export HIVE_HOME
export HIVE_STATE_DIR
export HIVE_ELIXIR_DATABASE_PATH
export DATABASE_PATH

exec turbo run dev --ui=tui --env-mode=loose --filter=web --filter=@hive/server-elixir
