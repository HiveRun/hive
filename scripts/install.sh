#!/usr/bin/env sh
set -eu

OWNER="SyntheticRun"
REPO="synthetic"
INSTALL_ROOT="${SYNTHETIC_HOME:-$HOME/.synthetic}"
BIN_DIR="$INSTALL_ROOT/bin"
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

echo "Downloading Synthetic (${platform}/${arch})"
curl -fsSL "$download" -o "$workdir/package.tgz"
tar -xzf "$workdir/package.tgz" -C "$workdir"
release_dir=$(tar -tzf "$workdir/package.tgz" | head -1 | cut -d/ -f1)

src="$workdir/$release_dir"
[ -d "$src" ] || { echo "Archive missing payload" >&2; exit 1; }

target="$RELEASES_DIR/$release_dir"
rm -rf "$target"
mv "$src" "$target"

cat > "$target/synthetic.env" <<EOF
DATABASE_URL="$STATE_DIR/synthetic.db"
SYNTHETIC_WEB_DIST="$target/public"
EOF

ln -snf "$target" "$INSTALL_ROOT/current"
ln -snf "$target/synthetic" "$BIN_DIR/synthetic"
chmod +x "$BIN_DIR/synthetic"

cat <<EOF
Synthetic installed to $target
Add to your shell profile if needed:
  export PATH="$BIN_DIR:\$PATH"

Launch with:
  synthetic
EOF
