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

for pattern in "${PATTERNS[@]}"; do
    # Search in staged files only, excluding lockfiles and package integrity hashes
    if git diff --cached --name-only \
        | grep -v -E "\.(lock|sum)$|package-lock\.json$|yarn\.lock$|bun\.lock$|routeTree\.gen\.ts$" \
        | xargs grep -l -E -i "$pattern" 2>/dev/null; then
        echo "⚠️  Potential secret found matching pattern: $pattern"
        git diff --cached --name-only \
            | grep -v -E "\.(lock|sum)$|package-lock\.json$|yarn\.lock$|bun\.lock$|routeTree\.gen\.ts$" \
            | xargs grep -n -E -i "$pattern" 2>/dev/null
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