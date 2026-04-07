#!/usr/bin/env bash

set -euo pipefail

eval "$(bun run scripts/dev/dev-ports.ts --shell)"

HIVE_HOME="${HIVE_HOME:-$(pwd)/.hive}"
HIVE_STATE_DIR="${HIVE_STATE_DIR:-${HIVE_HOME}/state}"
HIVE_ELIXIR_DATABASE_PATH="${HIVE_ELIXIR_DATABASE_PATH:-${HIVE_STATE_DIR}/hive_server_elixir_dev.db}"
DATABASE_PATH="${DATABASE_PATH:-${HIVE_ELIXIR_DATABASE_PATH}}"

mkdir -p "${HIVE_STATE_DIR}"

echo "[hive:dev:warm] web port: ${FRONTEND_PORT}"
echo "[hive:dev:warm] api port: ${BACKEND_PORT}"
echo "[hive:dev:warm] api url: ${BACKEND_URL}"
echo "[hive:dev:warm] db path: ${HIVE_ELIXIR_DATABASE_PATH}"

export HIVE_HOME
export HIVE_STATE_DIR
export HIVE_ELIXIR_DATABASE_PATH
export DATABASE_PATH

web_pid=""
server_pid=""

cleanup() {
  local exit_code=$?

  if [ -n "${web_pid}" ]; then
    kill -TERM -- "-${web_pid}" 2>/dev/null || true
  fi

  if [ -n "${server_pid}" ]; then
    kill -TERM -- "-${server_pid}" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

setsid bun run --cwd apps/web dev &
web_pid="$!"

setsid bun run --cwd apps/hive_server_elixir dev:warm &
server_pid="$!"

wait -n "${web_pid}" "${server_pid}"
