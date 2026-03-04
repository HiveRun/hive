#!/usr/bin/env bash

set -euo pipefail

eval "$(bun run scripts/dev/dev-ports.ts --shell)"

echo "[hive:dev] web port: ${HIVE_DEV_WEB_PORT}"
echo "[hive:dev] api port: ${HIVE_DEV_API_PORT}"
echo "[hive:dev] api url: ${HIVE_DEV_API_URL}"

cleanup() {
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi

  if [[ -n "${ELIXIR_PID:-}" ]]; then
    kill "${ELIXIR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

PORT="${HIVE_DEV_WEB_PORT}" VITE_API_URL="${HIVE_DEV_API_URL}" bun run dev:web &
WEB_PID=$!

PORT="${HIVE_DEV_API_PORT}" bun run dev:server-elixir &
ELIXIR_PID=$!

wait -n "${WEB_PID}" "${ELIXIR_PID}"
