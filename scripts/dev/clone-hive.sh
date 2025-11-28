#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="$ROOT_DIR/vendor/hive"
REPO_URL="git@github.com:HiveRun/hive.git"

mkdir -p "$ROOT_DIR/vendor"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Updating existing Hive checkout..."
  git -C "$TARGET_DIR" pull --ff-only
else
  if [ -e "$TARGET_DIR" ]; then
    echo "Removing stale Hive directory..."
    rm -rf "$TARGET_DIR"
  fi

  echo "Cloning Hive repository..."
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo "Hive reference ready at $TARGET_DIR"
