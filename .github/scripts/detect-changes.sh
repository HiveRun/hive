#!/bin/bash
set -e

# Detects which parts of the monorepo changed for intelligent CI job filtering
# Usage: ./detect-changes.sh <base-ref>
# Outputs: Sets GitHub Actions outputs for skip_all, run_web, run_server, run_e2e, run_audit

BASE_REF=$1

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "origin/${BASE_REF}...HEAD")

# Check if CI infrastructure changed (always run CI to validate)
CI_INFRASTRUCTURE_CHANGED=false
if echo "$CHANGED_FILES" | grep -qE '^\.github/(workflows|scripts|actions)/'; then
  CI_INFRASTRUCTURE_CHANGED=true
  echo "skip_all=false" >> "$GITHUB_OUTPUT"
  echo "✓ CI infrastructure changed, running all checks to validate"
  # Continue to detect what else changed below
else
  # Pattern for docs/config files that don't require CI
  DOCS_PATTERN='^(README\.md|docs/|\.github/|\.husky/|\.vscode/|\.zed/|\.ruler/|.*\.md$|LICENSE|\.gitignore|\.editorconfig)'

  # Check if only docs/config changed
  if echo "$CHANGED_FILES" | grep -qvE "$DOCS_PATTERN"; then
    echo "skip_all=false" >> "$GITHUB_OUTPUT"
  else
    echo "skip_all=true" >> "$GITHUB_OUTPUT"
    echo "✓ Only docs/config files changed, skipping all jobs"
    exit 0
  fi
fi

# Detect dependency changes (for security audit)
if [ "$CI_INFRASTRUCTURE_CHANGED" = true ] || echo "$CHANGED_FILES" | grep -qE '^(package\.json|bun\.lock|apps/.*/package\.json)'; then
  echo "run_audit=true" >> "$GITHUB_OUTPUT"
  echo "✓ Dependency changes detected, will run security audit"
else
  echo "run_audit=false" >> "$GITHUB_OUTPUT"
  echo "✓ No dependency changes, skipping security audit"
fi

# Detect web changes (apps/web or root config affecting web)
if [ "$CI_INFRASTRUCTURE_CHANGED" = true ] || echo "$CHANGED_FILES" | grep -qE '^(apps/web/|package\.json|turbo\.json|tsconfig.*\.json|biome\.json|bun\.lock)'; then
  echo "run_web=true" >> "$GITHUB_OUTPUT"
  echo "run_e2e=true" >> "$GITHUB_OUTPUT"
  echo "✓ Web changes detected"
else
  echo "run_web=false" >> "$GITHUB_OUTPUT"
  echo "run_e2e=false" >> "$GITHUB_OUTPUT"
  echo "✓ No web changes detected"
fi

# Detect server changes (apps/server or root config affecting server)
if [ "$CI_INFRASTRUCTURE_CHANGED" = true ] || echo "$CHANGED_FILES" | grep -qE '^(apps/server/|package\.json|turbo\.json|tsconfig.*\.json|biome\.json|bun\.lock)'; then
  echo "run_server=true" >> "$GITHUB_OUTPUT"
  echo "✓ Server changes detected"
else
  echo "run_server=false" >> "$GITHUB_OUTPUT"
  echo "✓ No server changes detected"
fi
