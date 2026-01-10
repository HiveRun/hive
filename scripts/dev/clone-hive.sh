#!/usr/bin/env bash
set -euo pipefail

if [ "${HIVE_WORKTREE_SETUP:-}" = "true" ]; then
  echo "Skipping Hive reference clone in worktree setup mode."
  exit 0
fi

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [--reset]

Ensures vendor/hive is available locally.
  --reset, -r   Fetch latest changes and hard reset the checkout
  --help, -h    Show this help message
EOF
}

RESET=false

while (($#)); do
  case "$1" in
    --reset|-r)
      RESET=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="$ROOT_DIR/vendor/hive"
REPO_URL="git@github.com:HiveRun/hive.git"

mkdir -p "$ROOT_DIR/vendor"

if [ -d "$TARGET_DIR" ]; then
  if [ "$RESET" = true ]; then
    echo "Refreshing Hive checkout at $TARGET_DIR..."
    git -C "$TARGET_DIR" fetch --prune
    DEFAULT_HEAD="$(git -C "$TARGET_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
    git -C "$TARGET_DIR" reset --hard "$DEFAULT_HEAD"
    git -C "$TARGET_DIR" clean -fdx
  else
    echo "Hive directory already exists at $TARGET_DIR; skipping clone (use --reset to refresh)."
  fi
else
  if [ -e "$TARGET_DIR" ]; then
    echo "Removing stale Hive directory..."
    rm -rf "$TARGET_DIR"
  fi

  echo "Cloning Hive repository..."
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo "Hive reference ready at $TARGET_DIR"
