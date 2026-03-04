#!/usr/bin/env bash

set -euo pipefail

cleanup() {
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi

  if [[ -n "${ELIXIR_PID:-}" ]]; then
    kill "${ELIXIR_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

bun run dev:web &
WEB_PID=$!

bun run dev:server-elixir &
ELIXIR_PID=$!

wait -n "${WEB_PID}" "${ELIXIR_PID}"
