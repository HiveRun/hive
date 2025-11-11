# CI/CD Configuration

This directory contains the GitHub Actions CI/CD configuration for the Synthetic monorepo.

## Overview

Our CI system is optimized for **speed** and **cost-efficiency** using Blacksmith runners and intelligent caching strategies.

### Key Features

- ✅ **Blacksmith Runners** - High-performance bare-metal runners (2vCPU)
- ✅ **Turborepo Remote Caching** - Shared build/test outputs across jobs and runs
- ✅ **Path-based Filtering** - Only runs tests for changed code
- ✅ **Auto-cancel** - Cancels outdated runs when new commits are pushed
- ✅ **PR-only Execution** - No CI runs on deploy to main/master

## Workflows

### [`ci.yml`](./workflows/ci.yml)

Main CI workflow that runs on pull requests. Includes 3 jobs:

1. **detect-changes** - Determines which apps changed
2. **quality-checks** - Lint, type check, security, unit tests
3. **build** - Builds all packages
4. **e2e** - Visual regression tests (only if web changed)

**Triggers:** Pull requests to main/master (not on draft PRs)

## Custom Actions

### [`setup-bun-turbo`](./actions/setup-bun-turbo/action.yml)

Composite action that handles common setup steps:
- Installs Bun
- Caches dependencies
- Configures Turborepo remote cache

**Usage:**
```yaml
- uses: ./.github/actions/setup-bun-turbo
```

## Scripts

### [`detect-changes.sh`](./scripts/detect-changes.sh)

Detects which parts of the monorepo changed to optimize CI execution.

**Outputs:**
- `skip_all` - Skip all jobs (docs-only changes)
- `run_web` - Run web-related tests
- `run_server` - Run server-related tests
- `run_e2e` - Run E2E visual regression tests

**Path Detection Rules:**
- Docs-only (README, docs/, *.md, etc.) → Skip all
- `apps/web/**` changes → Run web tests + E2E
- `apps/server/**` changes → Run server tests
- Root config changes → Run all tests

## Performance

### Optimization Stack

1. **Turborepo Remote Caching** - 50-90% speed improvement on cache hits
2. **Dependency Caching** - ~60s → ~5s for `bun install`
3. **Path Filtering** - Skips unnecessary jobs (50-70% savings)
4. **Job Consolidation** - Reduced setup overhead
5. **Auto-cancel** - Prevents wasted runs on rapid iteration

### Typical Run Times

| Scenario | Duration | Cost |
|----------|----------|------|
| First run (cache miss) | ~4-6 min | ~$0.02 |
| No changes (cache hit) | ~30-60 sec | ~$0.005 |
| Small change | ~1-2 min | ~$0.01 |
| Docs-only | 0 sec | $0.00 |

### Free Tier Coverage

- **3,000 2vCPU minutes/month** free
- Covers **~5,000-10,000 PR runs/month** (with caching)

## Maintenance

### Updating Bun Version

Update in [`setup-bun-turbo/action.yml`](./actions/setup-bun-turbo/action.yml):
```yaml
inputs:
  bun-version:
    default: '1.2.20'  # Update this
```

### Adjusting Path Detection

Edit [`.github/scripts/detect-changes.sh`](./scripts/detect-changes.sh) to modify which paths trigger which jobs.

### Scaling Runners

If jobs are too slow, increase vCPU count in `ci.yml`:
```yaml
runs-on: blacksmith-4vcpu-ubuntu-2204  # Was: blacksmith-2vcpu-ubuntu-2204
```

Note: This doubles costs but halves execution time.

## Troubleshooting

### Cache Issues

Clear Turborepo cache:
```bash
# Locally
bun run turbo clean

# In CI: Clear GitHub Actions cache via repo settings
```

### Path Detection Not Working

Check the detect-changes job output in GitHub Actions to see what paths were detected.

### Jobs Not Running

1. Check if PR is marked as draft
2. Verify changed files match path patterns in `detect-changes.sh`
3. Check job `if` conditions in `ci.yml`
