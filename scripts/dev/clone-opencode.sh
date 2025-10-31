#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="$ROOT_DIR/vendor/opencode"
REPO_URL="https://github.com/sst/opencode.git"

mkdir -p "$ROOT_DIR/vendor"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Updating existing OpenCode checkout..."
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning OpenCode repository..."
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo "OpenCode reference ready at $TARGET_DIR"
