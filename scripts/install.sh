#!/usr/bin/env bash
set -euo pipefail

OWNER="HiveRun"
REPO="hive"
INSTALL_ROOT="${HIVE_HOME:-$HOME/.hive}"
BIN_DIR="${HIVE_BIN_DIR:-$INSTALL_ROOT/bin}"
DEFAULT_INSTALL_COMMAND="curl -fsSL https://raw.githubusercontent.com/$OWNER/$REPO/main/scripts/install.sh | bash"
RELEASES_DIR="$INSTALL_ROOT/releases"
STATE_DIR="$INSTALL_ROOT/state"
VERSION="${HIVE_VERSION:-latest}"
CUSTOM_URL="${HIVE_INSTALL_URL:-}"
OPENCODE_INSTALL_URL="${HIVE_OPENCODE_INSTALL_URL:-https://opencode.ai/install}"
SKIP_OPENCODE_INSTALL="${HIVE_SKIP_OPENCODE_INSTALL:-0}"
OPENCODE_BIN="${HIVE_OPENCODE_BIN:-}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command '$1'" >&2
    exit 1
  fi
}

resolve_opencode_bin() {
  if [ -n "$OPENCODE_BIN" ] && [ -x "$OPENCODE_BIN" ]; then
    printf '%s\n' "$OPENCODE_BIN"
    return 0
  fi

  if command -v opencode >/dev/null 2>&1; then
    command -v opencode
    return 0
  fi

  for candidate in "$HOME/.opencode/bin/opencode" "$HOME/.local/bin/opencode" "$HOME/bin/opencode"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

ensure_opencode_cli() {
  if [ "$SKIP_OPENCODE_INSTALL" = "1" ]; then
    if resolved=$(resolve_opencode_bin); then
      OPENCODE_BIN="$resolved"
      echo "Using existing OpenCode CLI at $OPENCODE_BIN"
    else
      echo "Skipping OpenCode CLI install (HIVE_SKIP_OPENCODE_INSTALL=1)"
    fi
    return
  fi

  if resolved=$(resolve_opencode_bin); then
    OPENCODE_BIN="$resolved"
    echo "Using existing OpenCode CLI at $OPENCODE_BIN"
    return
  fi

  echo "OpenCode CLI not found. Installing via $OPENCODE_INSTALL_URL"
  if ! curl -fsSL "$OPENCODE_INSTALL_URL" | bash; then
    echo "Error: failed to install OpenCode CLI" >&2
    exit 1
  fi

  if resolved=$(resolve_opencode_bin); then
    OPENCODE_BIN="$resolved"
    echo "Installed OpenCode CLI at $OPENCODE_BIN"
    return
  fi

  echo "Error: OpenCode CLI is still unavailable after install" >&2
  echo "Try running: curl -fsSL https://opencode.ai/install | bash" >&2
  exit 1
}

probe_hive_health() {
  local port="$1"
  local response
  local host

  for host in "127.0.0.1" "localhost" "[::1]"; do
    response=$(curl -fsS --max-time 1 "http://${host}:${port}/health" 2>/dev/null || true)

    if printf '%s' "$response" | grep -Eq '"service"[[:space:]]*:[[:space:]]*"hive"' && \
      printf '%s' "$response" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      return 0
    fi
  done

  return 1
}

resolve_existing_hive_port() {
  local env_file="$INSTALL_ROOT/current/hive.env"

  if [ -f "$env_file" ]; then
    local configured_port
    configured_port=$(grep -E '^PORT=' "$env_file" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
    if [ -n "$configured_port" ]; then
      printf '%s\n' "$configured_port"
      return 0
    fi
  fi

  printf '%s\n' "${PORT:-3000}"
}

env_file_has_key() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] && grep -Eq "^${key}=" "$file"
}

write_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  local escaped_value
  tmp_file=$(mktemp)
  escaped_value=${value//\\/\\\\}
  escaped_value=${escaped_value//\"/\\\"}

  if [ -f "$file" ]; then
    grep -Ev "^${key}=" "$file" > "$tmp_file" || true
  fi

  printf '%s="%s"\n' "$key" "$escaped_value" >> "$tmp_file"
  mv "$tmp_file" "$file"
}

seed_hive_env() {
  local file="$1"
  local current_env="$INSTALL_ROOT/current/hive.env"

  if [ -f "$current_env" ]; then
    cp "$current_env" "$file"
    return
  fi

  : > "$file"
}

stop_running_hive() {
  local existing_hive="$BIN_DIR/hive"
  local port
  port=$(resolve_existing_hive_port)

  if [ -x "$existing_hive" ]; then
    "$existing_hive" stop >/dev/null 2>&1 || true
  fi

  if probe_hive_health "$port" && command -v lsof >/dev/null 2>&1; then
    local pid
    pid=$(lsof -n -P -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)

    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true

      local attempt
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if ! probe_hive_health "$port"; then
          break
        fi
        sleep 1
      done
    fi
  fi

  if probe_hive_health "$port" && command -v ss >/dev/null 2>&1; then
    local pid
    pid=$(ss -ltnp "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2 || true)

    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true

      local attempt
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if ! probe_hive_health "$port"; then
          break
        fi
        sleep 1
      done
    fi
  fi

  if probe_hive_health "$port"; then
    echo "Error: a running Hive daemon is still responding on http://127.0.0.1:${port}. Stop it before reinstalling." >&2
    exit 1
  fi
}

add_path_entry() {
  local file="$1"
  local command_line="$2"

  if [ -f "$file" ] && grep -Fqx "$command_line" "$file"; then
    echo "Hive bin directory already exported in $file"
    return
  fi

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if [ ! -w "$file" ]; then
    echo "Add Hive to PATH manually by appending:\n  $command_line\nto $file"
    return
  fi

  {
    printf '\n# hive\n'
    printf '%s\n' "$command_line"
  } >> "$file"
  echo "Added $BIN_DIR to PATH in $file"
}

configure_shell_path() {
  if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    return
  fi

  local shell_name
  shell_name=$(basename "${SHELL:-}")
  local xdg_config="${XDG_CONFIG_HOME:-$HOME/.config}"
  local command_line
  local -a candidates

  case "$shell_name" in
    fish)
      candidates=([0]="$HOME/.config/fish/config.fish")
      command_line="fish_add_path $BIN_DIR"
      ;;
    zsh)
      candidates=("$HOME/.zshrc" "$HOME/.zshenv" "$xdg_config/zsh/.zshrc" "$xdg_config/zsh/.zshenv")
      command_line="export PATH=$BIN_DIR:\$PATH"
      ;;
    bash)
      candidates=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$xdg_config/bash/.bashrc" "$xdg_config/bash/.bash_profile")
      command_line="export PATH=$BIN_DIR:\$PATH"
      ;;
    ash|sh)
      candidates=("$HOME/.profile" "/etc/profile")
      command_line="export PATH=$BIN_DIR:\$PATH"
      ;;
    *)
      candidates=("$HOME/.profile")
      command_line="export PATH=$BIN_DIR:\$PATH"
      ;;
  esac

  local target=""
  for file in "${candidates[@]}"; do
    if [ -f "$file" ]; then
      target="$file"
      break
    fi
  done

  if [ -z "$target" ]; then
    target="${candidates[0]}"
  fi

  add_path_entry "$target" "$command_line"
}

os=$(uname -s)
case "$os" in
  Linux*) platform="linux" ;;
  Darwin*) platform="darwin" ;;
  *) echo "Unsupported OS: $os" >&2 && exit 1 ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2 && exit 1 ;;
esac

filename="hive-${platform}-${arch}.tar.gz"
if [ -n "$CUSTOM_URL" ]; then
  download="$CUSTOM_URL"
elif [ "$VERSION" = "latest" ]; then
  download="https://github.com/${OWNER}/${REPO}/releases/latest/download/${filename}"
else
  download="https://github.com/${OWNER}/${REPO}/releases/download/${VERSION}/${filename}"
fi

require curl
require tar
mkdir -p "$BIN_DIR" "$RELEASES_DIR" "$STATE_DIR"
ensure_opencode_cli
stop_running_hive

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

archive_path="$workdir/package.tgz"

if [[ "$download" == file://* ]]; then
  local_file="${download#file://}"
  if [ ! -f "$local_file" ]; then
    echo "Error: local archive $local_file not found" >&2
    exit 1
  fi
  echo "Copying Hive archive from $local_file"
  cp "$local_file" "$archive_path"
else
  echo "Downloading Hive (${platform}/${arch})"
  curl -fsSL "$download" -o "$archive_path"
fi

install_command_override="${HIVE_INSTALL_COMMAND:-}"

tar -xzf "$archive_path" -C "$workdir"
release_dir=$(tar -tzf "$archive_path" | head -1 | cut -d/ -f1 || true)

src="$workdir/$release_dir"
[ -d "$src" ] || { echo "Archive missing payload" >&2; exit 1; }

target="$RELEASES_DIR/$release_dir"
if [ -e "$target" ]; then
  target=$(mktemp -d "$RELEASES_DIR/${release_dir}.XXXXXX")
  rm -rf "$target"
fi

mv "$src" "$target"

seed_hive_env "$target/hive.env"

if ! env_file_has_key "$target/hive.env" "DATABASE_URL"; then
  write_env_var "$target/hive.env" "DATABASE_URL" "$STATE_DIR/hive.db"
fi

write_env_var "$target/hive.env" "HIVE_WEB_DIST" "$target/public"
write_env_var "$target/hive.env" "HIVE_MIGRATIONS_DIR" "$target/migrations"
if ! env_file_has_key "$target/hive.env" "HIVE_LOG_DIR"; then
  write_env_var "$target/hive.env" "HIVE_LOG_DIR" "$INSTALL_ROOT/logs"
fi

write_env_var "$target/hive.env" "HIVE_INSTALL_URL" "$download"

if [ -n "$install_command_override" ]; then
  write_env_var "$target/hive.env" "HIVE_INSTALL_COMMAND" "$install_command_override"
fi

if [ -n "$OPENCODE_BIN" ] && ! env_file_has_key "$target/hive.env" "HIVE_OPENCODE_BIN"; then
  write_env_var "$target/hive.env" "HIVE_OPENCODE_BIN" "$OPENCODE_BIN"
fi

ln -snf "$target" "$INSTALL_ROOT/current"
ln -snf "$target/hive" "$BIN_DIR/hive"
chmod +x "$BIN_DIR/hive"

configure_shell_path

cat <<EOF
Hive installed to $target

Launch with:
  hive
EOF
