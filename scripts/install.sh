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
EXPECTED_OPENCODE_VERSION="opencode2 v0.0.0-beta-18866"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command '$1'" >&2
    exit 1
  fi
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

opencode_binary_name="opencode2"
opencode_binary="$target/$opencode_binary_name"
opencode_launcher="$BIN_DIR/$opencode_binary_name"
if [ ! -x "$opencode_binary" ]; then
  echo "Error: bundled OpenCode 2 binary missing or not executable at $opencode_binary" >&2
  exit 1
fi

if ! opencode_version_output=$("$opencode_binary" --version 2>&1); then
  echo "Error: bundled OpenCode 2 binary cannot run on this platform" >&2
  exit 1
fi
opencode_version_output="${opencode_version_output#"${opencode_version_output%%[![:space:]]*}"}"
opencode_version_output="${opencode_version_output%"${opencode_version_output##*[![:space:]]}"}"
if [ "$opencode_version_output" != "$EXPECTED_OPENCODE_VERSION" ]; then
  echo "Error: bundled OpenCode 2 version mismatch: expected '$EXPECTED_OPENCODE_VERSION', received '$opencode_version_output'" >&2
  exit 1
fi

seed_hive_env "$target/hive.env"

if ! env_file_has_key "$target/hive.env" "DATABASE_URL"; then
  write_env_var "$target/hive.env" "DATABASE_URL" "$STATE_DIR/hive.db"
fi

write_env_var "$target/hive.env" "HIVE_WEB_DIST" "$target/public"
write_env_var "$target/hive.env" "HIVE_MIGRATIONS_DIR" "$target/migrations"
write_env_var "$target/hive.env" "HIVE_OPENCODE_BIN" "$opencode_binary"
if ! env_file_has_key "$target/hive.env" "HIVE_LOG_DIR"; then
  write_env_var "$target/hive.env" "HIVE_LOG_DIR" "$INSTALL_ROOT/logs"
fi

write_env_var "$target/hive.env" "HIVE_INSTALL_URL" "$download"

if [ -n "$install_command_override" ]; then
  write_env_var "$target/hive.env" "HIVE_INSTALL_COMMAND" "$install_command_override"
fi

if [ -e "$opencode_launcher" ] || [ -L "$opencode_launcher" ]; then
  managed_opencode_launcher=0
  if [ -L "$opencode_launcher" ]; then
    existing_opencode_target=$(readlink "$opencode_launcher")
    case "$existing_opencode_target" in
      "$INSTALL_ROOT"/*) managed_opencode_launcher=1 ;;
    esac
  elif grep -Fxq '# Managed by Hive: opencode2' "$opencode_launcher" 2>/dev/null; then
    managed_opencode_launcher=1
  fi

  if [ "$managed_opencode_launcher" != "1" ]; then
    echo "Error: refusing to replace unmanaged OpenCode command at $opencode_launcher" >&2
    exit 1
  fi
fi

ln -snf "$target" "$INSTALL_ROOT/current"
ln -snf "$target/hive" "$BIN_DIR/hive"
rm -f "$opencode_launcher"
printf '#!/usr/bin/env bash\n# Managed by Hive: opencode2\nexport OPENCODE_DISABLE_AUTOUPDATE=1\nexec %q "$@"\n' "$opencode_binary" > "$opencode_launcher"
chmod +x "$BIN_DIR/hive"
chmod +x "$opencode_launcher"

echo "Using bundled OpenCode 2 CLI at $opencode_binary"

configure_shell_path

cat <<EOF
Hive installed to $target

Launch with:
  hive
EOF
