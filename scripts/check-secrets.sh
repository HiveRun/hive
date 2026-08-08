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
    matches="$(git diff --cached --name-only \
        | grep -v -E "\.(lock|sum)$|package-lock\.json$|yarn\.lock$|bun\.lock$|routeTree\.gen\.ts$|skills-lock\.json$|^\.agents/skills/agent-browser/references/commands\.md$" \
        | xargs grep -n -H -E -i "$pattern" 2>/dev/null \
        | grep -v -E '\.patch:[0-9]+:index [0-9a-f]{40,64}\.\.[0-9a-f]{40,64} [0-9]{6}$' \
        || true)"
    if [ -n "$matches" ]; then
        echo "⚠️  Potential secret found matching pattern: $pattern"
        printf '%s\n' "$matches"
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
