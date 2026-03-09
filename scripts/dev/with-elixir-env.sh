#!/usr/bin/env bash

set -euo pipefail

workdir="${1:?workdir is required}"
shift

if [ "${1:-}" = "--" ]; then
  shift
fi

if command -v mise >/dev/null 2>&1; then
  exec mise x -C "$workdir" -- "$@"
fi

cd "$workdir"
exec "$@"
