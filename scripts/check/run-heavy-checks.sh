#!/usr/bin/env bash

set -euo pipefail

declare -a pids=()
declare -a names=()

start_job() {
  local name="$1"
  shift

  echo "==> $name"
  "$@" &
  pids+=("$!")
  names+=("$name")
}

start_job "Tests" bun run test:run
start_job "Type checks" bun run check-types
start_job "Elixir server checks" bun run check:server-elixir
start_job "Build" bun run build

status=0

for index in "${!pids[@]}"; do
  pid="${pids[$index]}"
  name="${names[$index]}"

  if ! wait "$pid"; then
    echo "!! $name failed" >&2
    status=1
  fi
done

exit "$status"
