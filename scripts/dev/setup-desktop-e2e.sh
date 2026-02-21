#!/usr/bin/env bash
set -euo pipefail

if [[ "${HIVE_SKIP_DESKTOP_E2E_SETUP:-0}" == "1" ]]; then
  echo "Skipping desktop E2E setup (HIVE_SKIP_DESKTOP_E2E_SETUP=1)."
  exit 0
fi

echo "Preparing desktop Electron E2E prerequisites..."

if [[ "$(uname -s)" == "Linux" ]]; then
  if ! command -v dpkg >/dev/null 2>&1; then
    cat <<'EOF'
Linux detected, but dpkg is unavailable.
Install Electron runtime dependencies listed in apps/e2e-desktop/README.md.
EOF
    echo "Desktop Electron E2E setup complete."
    exit 0
  fi

  LINUX_PACKAGE_GROUPS=(
    "xvfb"
    "libnss3"
    "libatk-bridge2.0-0t64 libatk-bridge2.0-0"
    "libdrm2"
    "libxkbcommon0"
    "libxcomposite1"
    "libxdamage1"
    "libxrandr2"
    "libgbm1"
    "libasound2t64 libasound2"
  )

  resolve_linux_package() {
    local candidates=("$@")
    for candidate in "${candidates[@]}"; do
      if dpkg -s "$candidate" >/dev/null 2>&1; then
        printf '%s\n' "$candidate"
        return 0
      fi

      if command -v apt-cache >/dev/null 2>&1 && apt-cache show "$candidate" >/dev/null 2>&1; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done

    printf '%s\n' "${candidates[0]}"
  }

  RESOLVED_PACKAGES=()
  for package_group in "${LINUX_PACKAGE_GROUPS[@]}"; do
    # shellcheck disable=SC2206
    group_candidates=( $package_group )
    RESOLVED_PACKAGES+=("$(resolve_linux_package "${group_candidates[@]}")")
  done

  MISSING_PACKAGES=()
  for package in "${RESOLVED_PACKAGES[@]}"; do
    if ! dpkg -s "$package" >/dev/null 2>&1; then
      MISSING_PACKAGES+=("$package")
    fi
  done

  print_install_command() {
    local packages=("$@")
    echo "  sudo apt-get update"
    echo "  sudo apt-get install -y \\"
    local package
    for package in "${packages[@]}"; do
      echo "    $package \\"
    done
    echo ""
  }

  if [[ ${#MISSING_PACKAGES[@]} -gt 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      if sudo -n true >/dev/null 2>&1; then
        echo "Auto-installing missing Linux desktop Electron dependencies..."
        if sudo -n apt-get update && sudo -n apt-get install -y "${MISSING_PACKAGES[@]}"; then
          echo "Linux desktop Electron dependencies installed."
        else
          echo "Automatic Linux dependency installation failed."
          echo ""
          echo "Install them manually with:"
          print_install_command "${MISSING_PACKAGES[@]}"
        fi
      else
        echo "Linux desktop Electron dependencies are missing:"
        echo "  ${MISSING_PACKAGES[*]}"
        echo ""
        echo "Skipping auto-install to avoid an interactive sudo prompt."
        echo ""
        echo "Install them manually with:"
        print_install_command "${MISSING_PACKAGES[@]}"
        echo "If you do not need desktop E2E prerequisites right now, rerun with:"
        echo "  HIVE_SKIP_DESKTOP_E2E_SETUP=1 bun setup"
      fi
    else
      echo "Linux desktop Electron dependencies are missing:"
      echo "  ${MISSING_PACKAGES[*]}"
      echo ""
      echo "Cannot auto-install because sudo is unavailable."
      echo ""
      echo "Install them manually with:"
      print_install_command "${MISSING_PACKAGES[@]}"
    fi
  else
    echo "Linux desktop Electron dependencies already installed."
  fi
fi

echo "Desktop Electron E2E setup complete."
