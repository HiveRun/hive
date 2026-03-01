#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="$ROOT_DIR/tmp/agent-browser"
SCREENSHOT_DIR="$ARTIFACT_DIR/screenshots"
VIDEO_DIR="$ARTIFACT_DIR/videos"

ab() {
  npx agent-browser "$@"
}

ensure_extension() {
  local name="$1"
  local extension="$2"

  if [[ "$name" == *.* ]]; then
    printf "%s\n" "$name"
    return
  fi

  printf "%s%s\n" "$name" "$extension"
}

resolve_output_path() {
  local input_name="$1"
  local default_dir="$2"
  local extension="$3"
  local with_extension

  with_extension="$(ensure_extension "$input_name" "$extension")"

  if [[ "$with_extension" == */* ]]; then
    printf "%s\n" "$with_extension"
    return
  fi

  printf "%s/%s\n" "$default_dir" "$with_extension"
}

find_latest() {
  local dir="$1"
  local pattern="$2"
  local latest

  latest="$(ls -1t "$dir"/$pattern 2>/dev/null | head -n 1 || true)"

  if [[ -z "$latest" ]]; then
    return 1
  fi

  printf "%s\n" "$latest"
}

ensure_viewer() {
  if ! command -v xdg-open >/dev/null 2>&1; then
    echo "xdg-open is not installed; open the file manually instead."
    exit 1
  fi
}

case "${1:-}" in
  shot)
    mkdir -p "$SCREENSHOT_DIR"
    file_name="${2:-latest}"
    output_path="$(resolve_output_path "$file_name" "$SCREENSHOT_DIR" ".png")"
    mkdir -p "$(dirname "$output_path")"
    ab screenshot "$output_path"
    printf "Saved screenshot: %s\n" "$output_path"
    ;;

  record-start)
    mkdir -p "$VIDEO_DIR"
    file_name="${2:-latest}"
    output_path="$(resolve_output_path "$file_name" "$VIDEO_DIR" ".webm")"
    mkdir -p "$(dirname "$output_path")"
    ab record start "$output_path"
    printf "Recording to: %s\n" "$output_path"
    ;;

  record-stop)
    ab record stop
    ;;

  latest)
    latest_path="$(find_latest "$SCREENSHOT_DIR" "*.png" || true)"
    if [[ -z "$latest_path" ]]; then
      echo "No screenshot found in $SCREENSHOT_DIR"
      exit 1
    fi
    printf "%s\n" "$latest_path"
    ;;

  latest-video)
    latest_path="$(find_latest "$VIDEO_DIR" "*.webm" || true)"
    if [[ -z "$latest_path" ]]; then
      echo "No video found in $VIDEO_DIR"
      exit 1
    fi
    printf "%s\n" "$latest_path"
    ;;

  view)
    ensure_viewer
    latest_path="$($0 latest)"
    xdg-open "$latest_path" >/dev/null 2>&1 &
    printf "Opened: %s\n" "$latest_path"
    ;;

  view-video)
    ensure_viewer
    latest_path="$($0 latest-video)"
    xdg-open "$latest_path" >/dev/null 2>&1 &
    printf "Opened: %s\n" "$latest_path"
    ;;

  *)
    echo "Usage: scripts/agent-browser.sh <command> [name]"
    echo ""
    echo "Commands:"
    echo "  shot [name]         Save screenshot (default: latest.png)"
    echo "  record-start [name] Start recording (default: latest.webm)"
    echo "  record-stop         Stop recording"
    echo "  latest              Print latest screenshot path"
    echo "  latest-video        Print latest video path"
    echo "  view                Open latest screenshot via xdg-open"
    echo "  view-video          Open latest video via xdg-open"
    exit 1
    ;;
esac
