#!/bin/bash
set -e

# Detects which parts of the monorepo changed for intelligent CI job filtering
# Usage: ./detect-changes.sh <base-ref>
# Outputs: Sets GitHub Actions outputs for skip_all, run_web, run_server, run_e2e

BASE_REF=$1

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "origin/${BASE_REF}...HEAD")

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

# Detect web changes (apps/web or root config affecting web)
if echo "$CHANGED_FILES" | grep -qE '^(apps/web/|package\.json|turbo\.json|tsconfig.*\.json|biome\.json|bun\.lock)'; then
  echo "run_web=true" >> "$GITHUB_OUTPUT"
  echo "run_e2e=true" >> "$GITHUB_OUTPUT"
  echo "✓ Web changes detected"
else
  echo "run_web=false" >> "$GITHUB_OUTPUT"
  echo "run_e2e=false" >> "$GITHUB_OUTPUT"
  echo "✓ No web changes detected"
fi

# Detect server changes (apps/server or root config affecting server)
if echo "$CHANGED_FILES" | grep -qE '^(apps/server/|package\.json|turbo\.json|tsconfig.*\.json|biome\.json|bun\.lock)'; then
  echo "run_server=true" >> "$GITHUB_OUTPUT"
  echo "✓ Server changes detected"
else
  echo "run_server=false" >> "$GITHUB_OUTPUT"
  echo "✓ No server changes detected"
fi
