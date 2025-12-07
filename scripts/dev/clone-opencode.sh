#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [--reset]

Ensures vendor/opencode is available locally.
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
TARGET_DIR="$ROOT_DIR/vendor/opencode"
REPO_URL="https://github.com/sst/opencode.git"

mkdir -p "$ROOT_DIR/vendor"

if [ "${HIVE_WORKTREE_SETUP:-}" = "true" ] && [ ! -d "$TARGET_DIR" ]; then
  if [ -n "${HIVE_MAIN_REPO:-}" ] && [ -d "$HIVE_MAIN_REPO/vendor/opencode" ]; then
    echo "HIVE_WORKTREE_SETUP=true and $TARGET_DIR is missing; copying from $HIVE_MAIN_REPO/vendor/opencode instead of cloning."
    mkdir -p "$(dirname "$TARGET_DIR")"
    cp -a "$HIVE_MAIN_REPO/vendor/opencode" "$TARGET_DIR"
    echo "OpenCode reference ready at $TARGET_DIR"
    exit 0
  fi

  echo "HIVE_WORKTREE_SETUP=true and $TARGET_DIR is missing; skipping clone to avoid network during provisioning."
  exit 0
fi

if [ -d "$TARGET_DIR" ]; then
  if [ "$RESET" = true ]; then
    echo "Refreshing OpenCode checkout at $TARGET_DIR..."
    git -C "$TARGET_DIR" fetch --prune
    DEFAULT_HEAD="$(git -C "$TARGET_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
    git -C "$TARGET_DIR" reset --hard "$DEFAULT_HEAD"
    git -C "$TARGET_DIR" clean -fdx
  elif [ "${HIVE_WORKTREE_SETUP:-}" = "true" ]; then
    echo "OpenCode directory already exists at $TARGET_DIR; skipping network operations for worktree setup."
  else
    echo "OpenCode directory already exists at $TARGET_DIR; skipping clone (use --reset to refresh)."
  fi
else
  echo "Cloning OpenCode repository..."
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

echo "OpenCode reference ready at $TARGET_DIR"
