#!/usr/bin/env bash
set -euo pipefail

if [[ "${HIVE_SKIP_DESKTOP_E2E_SETUP:-0}" == "1" ]]; then
  echo "Skipping desktop E2E setup (HIVE_SKIP_DESKTOP_E2E_SETUP=1)."
  exit 0
fi

echo "Preparing desktop Electron E2E prerequisites..."

if [[ "$(uname -s)" == "Linux" ]]; then
  LINUX_PACKAGES=(
    xvfb
    libnss3
    libatk-bridge2.0-0
    libdrm2
    libxkbcommon0
    libxcomposite1
    libxdamage1
    libxrandr2
    libgbm1
    libasound2
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
        echo "Auto-installing missing Linux desktop Electron dependencies..."
        if sudo apt-get update && sudo apt-get install -y "${MISSING_PACKAGES[@]}"; then
          echo "Linux desktop Electron dependencies installed."
        else
          cat <<EOF
Automatic Linux dependency installation failed.

Install them manually with:
  sudo apt-get update
  sudo apt-get install -y \
    xvfb \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2
EOF
        fi
      else
        cat <<EOF
Linux desktop Electron dependencies are missing:
  ${MISSING_PACKAGES[*]}

Cannot auto-install because sudo is unavailable.

Install them manually with:
  sudo apt-get update
  sudo apt-get install -y \
    xvfb \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2
EOF
      fi
    else
      echo "Linux desktop Electron dependencies already installed."
    fi
  else
    cat <<'EOF'
Linux detected, but dpkg is unavailable.
Install Electron runtime dependencies listed in apps/e2e-desktop/README.md.
EOF
  fi
fi

echo "Desktop Electron E2E setup complete."
