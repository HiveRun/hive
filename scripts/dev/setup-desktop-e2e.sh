#!/usr/bin/env bash
set -euo pipefail

if [[ "${HIVE_SKIP_DESKTOP_E2E_SETUP:-0}" == "1" ]]; then
  echo "Skipping desktop E2E setup (HIVE_SKIP_DESKTOP_E2E_SETUP=1)."
  exit 0
fi

echo "Preparing desktop WebDriver E2E prerequisites..."

if ! command -v cargo >/dev/null 2>&1; then
  cat <<'EOF'
Cargo is not installed, so desktop WebDriver setup was skipped.

Install Rust/Cargo, then run:
  bun run setup:desktop-e2e
EOF
  exit 0
fi

if ! command -v tauri-driver >/dev/null 2>&1; then
  echo "Installing tauri-driver via cargo..."
  if ! cargo install tauri-driver --locked; then
    cat <<'EOF'
Warning: failed to install tauri-driver.
You can retry later with:
  bun run setup:desktop-e2e
EOF
    exit 0
  fi
else
  echo "tauri-driver already installed at $(command -v tauri-driver)"
fi

CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
if ! command -v tauri-driver >/dev/null 2>&1 && [[ -x "$CARGO_BIN/tauri-driver" ]]; then
  cat <<EOF
tauri-driver installed at:
  $CARGO_BIN/tauri-driver

Ensure Cargo binaries are on PATH in your shell:
  export PATH="$CARGO_BIN:\$PATH"
EOF
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  LINUX_PACKAGES=(
    libwebkit2gtk-4.1-dev
    libgtk-3-dev
    libayatana-appindicator3-dev
    librsvg2-dev
    libxdo-dev
    libssl-dev
    patchelf
    webkit2gtk-driver
    xvfb
  )

  if command -v dpkg >/dev/null 2>&1; then
    MISSING_PACKAGES=()
    for package in "${LINUX_PACKAGES[@]}"; do
      if ! dpkg -s "$package" >/dev/null 2>&1; then
        MISSING_PACKAGES+=("$package")
      fi
    done

    if [[ ${#MISSING_PACKAGES[@]} -gt 0 ]]; then
      if command -v sudo >/dev/null 2>&1; then
        echo "Auto-installing missing Linux desktop WebDriver dependencies..."
        if sudo apt-get update && sudo apt-get install -y "${MISSING_PACKAGES[@]}"; then
          echo "Linux desktop WebDriver dependencies installed."
        else
          cat <<EOF
Automatic Linux dependency installation failed.

Install them manually with:
  sudo apt-get update
  sudo apt-get install -y \\
    libwebkit2gtk-4.1-dev \\
    libgtk-3-dev \\
    libayatana-appindicator3-dev \\
    librsvg2-dev \\
    libxdo-dev \\
    libssl-dev \\
    patchelf \\
    webkit2gtk-driver \\
    xvfb
EOF
        fi
      else
        cat <<EOF
Linux desktop WebDriver dependencies are missing:
  ${MISSING_PACKAGES[*]}

Cannot auto-install because sudo is unavailable.

Install them manually with:
  sudo apt-get update
  sudo apt-get install -y \\
    libwebkit2gtk-4.1-dev \\
    libgtk-3-dev \\
    libayatana-appindicator3-dev \\
    librsvg2-dev \\
    libxdo-dev \\
    libssl-dev \\
    patchelf \\
    webkit2gtk-driver \\
    xvfb
EOF
      fi
    else
      echo "Linux desktop WebDriver dependencies already installed."
    fi
  else
    cat <<'EOF'
Linux detected, but dpkg is unavailable.
Install WebKit/GTK/Xvfb dependencies listed in apps/e2e-desktop/README.md.
EOF
  fi
fi

echo "Desktop WebDriver E2E setup complete."
