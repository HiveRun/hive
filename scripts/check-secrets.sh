#!/bin/bash

# Simple secrets detection script
echo "🔍 Checking for potential secrets..."

# Common secret patterns
PATTERNS=(
    "api_key\s*[:=]\s*['\"][^'\"]{20,}['\"]"
    "secret\s*[:=]\s*['\"][^'\"]{20,}['\"]"
    "password\s*[:=]\s*['\"][^'\"]{8,}['\"]"
    "token\s*[:=]\s*['\"][^'\"]{20,}['\"]"
    "sk_[a-zA-Z0-9]{20,}"
    "pk_[a-zA-Z0-9]{20,}"
    "[A-Za-z0-9]{40}"
    "AKIA[0-9A-Z]{16}"
)

FOUND_SECRETS=false

STAGED_FILES=$(git diff --cached --name-only | grep -v -E "\.(lock|sum)$|package-lock\.json$|yarn\.lock$|bun\.lock$" | grep -v "routeTree\.gen\.ts")

for pattern in "${PATTERNS[@]}"; do
    # Skip when there are no staged files to scan
    if [ -z "$STAGED_FILES" ]; then
        break
    fi

    # Search in staged files only, excluding lockfiles, package integrity hashes, and generated route trees
    if echo "$STAGED_FILES" | xargs grep -l -E -i "$pattern" 2>/dev/null; then
        echo "⚠️  Potential secret found matching pattern: $pattern"
        echo "$STAGED_FILES" | xargs grep -n -E -i "$pattern" 2>/dev/null
        FOUND_SECRETS=true
    fi
done

if [ "$FOUND_SECRETS" = true ]; then
    echo ""
    echo "❌ Potential secrets detected in staged files!"
    echo "Please review and remove any sensitive information before committing."
    exit 1
else
    echo "✅ No secrets detected in staged files."
    exit 0
fi