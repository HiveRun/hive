#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${HIVE_TMUX_SESSION:-hive-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMUX_CONF="$ROOT_DIR/tmux/dev.conf"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to run this script. Install tmux and try again." >&2
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Attaching to existing tmux session: $SESSION_NAME"
  exec tmux attach -t "$SESSION_NAME"
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:3000 -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    echo "Port 3000 is already in use. Stop the process or set PORT to a free port, then re-run." >&2
    exit 1
  fi
elif command -v ss >/dev/null 2>&1; then
  if ss -ltn sport = :3000 | awk 'NR>1 {found=1; exit} END{exit found?0:1}'; then
    echo "Port 3000 is already in use. Stop the process or set PORT to a free port, then re-run." >&2
    exit 1
  fi
else
  echo "Warning: unable to check port 3000 (no lsof or ss available)." >&2
fi

tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$ROOT_DIR/apps/server" -n dev "bun run dev"
tmux -f "$TMUX_CONF" set-hook -t "$SESSION_NAME" pane-exited "kill-session -t $SESSION_NAME"
tmux -f "$TMUX_CONF" split-window -h -t "$SESSION_NAME":1 -c "$ROOT_DIR/apps/web" "bun run dev"
tmux -f "$TMUX_CONF" select-pane -t "$SESSION_NAME":1.1
tmux -f "$TMUX_CONF" attach -t "$SESSION_NAME"
