#!/usr/bin/env bash
set -euo pipefail

OWNER="SyntheticRun"
REPO="synthetic"
INSTALL_ROOT="${SYNTHETIC_HOME:-$HOME/.synthetic}"
BIN_DIR="${SYNTHETIC_BIN_DIR:-$INSTALL_ROOT/bin}"
DEFAULT_INSTALL_COMMAND="curl -fsSL https://raw.githubusercontent.com/$OWNER/$REPO/main/scripts/install.sh | bash"
RELEASES_DIR="$INSTALL_ROOT/releases"
STATE_DIR="$INSTALL_ROOT/state"
VERSION="${SYNTHETIC_VERSION:-latest}"
CUSTOM_URL="${SYNTHETIC_INSTALL_URL:-}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command '$1'" >&2
    exit 1
  fi
}

add_path_entry() {
  local file="$1"
  local command_line="$2"

  if [ -f "$file" ] && grep -Fqx "$command_line" "$file"; then
    echo "Synthetic bin directory already exported in $file"
    return
  fi

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if [ ! -w "$file" ]; then
    echo "Add Synthetic to PATH manually by appending:\n  $command_line\nto $file"
    return
  fi

  {
    printf '\n# synthetic\n'
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

filename="synthetic-${platform}-${arch}.tar.gz"
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

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

archive_path="$workdir/package.tgz"

if [[ "$download" == file://* ]]; then
  local_file="${download#file://}"
  if [ ! -f "$local_file" ]; then
    echo "Error: local archive $local_file not found" >&2
    exit 1
  fi
  echo "Copying Synthetic archive from $local_file"
  cp "$local_file" "$archive_path"
else
  echo "Downloading Synthetic (${platform}/${arch})"
  curl -fsSL "$download" -o "$archive_path"
fi

install_command_value="${SYNTHETIC_INSTALL_COMMAND:-$DEFAULT_INSTALL_COMMAND}"

tar -xzf "$archive_path" -C "$workdir"
release_dir=$(tar -tzf "$archive_path" | head -1 | cut -d/ -f1 || true)

src="$workdir/$release_dir"
[ -d "$src" ] || { echo "Archive missing payload" >&2; exit 1; }

target="$RELEASES_DIR/$release_dir"
rm -rf "$target"
mv "$src" "$target"

cat > "$target/synthetic.env" <<EOF
DATABASE_URL="$STATE_DIR/synthetic.db"
SYNTHETIC_WEB_DIST="$target/public"
SYNTHETIC_MIGRATIONS_DIR="$target/migrations"
SYNTHETIC_LOG_DIR="$INSTALL_ROOT/logs"
SYNTHETIC_INSTALL_URL="$download"
SYNTHETIC_INSTALL_COMMAND="$install_command_value"
EOF

ln -snf "$target" "$INSTALL_ROOT/current"
ln -snf "$target/synthetic" "$BIN_DIR/synthetic"
chmod +x "$BIN_DIR/synthetic"

configure_shell_path

cat <<EOF
Synthetic installed to $target

Launch with:
  synthetic
EOF
