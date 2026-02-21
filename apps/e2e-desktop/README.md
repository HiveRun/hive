# Desktop Electron E2E

This package runs desktop smoke tests against a real Electron app using Playwright.

## Local Setup

1. Run one-time workspace setup (includes best-effort desktop Electron prep):

```bash
bun setup
```

If you only want to rerun desktop setup, use:

```bash
bun run setup:desktop-e2e
```

2. Linux only: install desktop runtime dependencies:

```bash
sudo apt-get update
sudo apt-get install -y \
  xvfb \
  libnss3 \
  libatk-bridge2.0-0t64 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libasound2t64
```

If your distro does not provide the `*t64` names, use `libatk-bridge2.0-0` and `libasound2`.

Tip: on Linux, the setup script automatically attempts to install missing packages via `sudo apt-get`.

## Run Tests

From repo root:

```bash
# Full desktop smoke suite
bun run test:e2e:desktop

# Single spec
bun run test:e2e:desktop:spec specs/smoke-launch.spec.ts
```

Linux headless run:

```bash
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" bun run test:e2e:desktop
```

Keep all run artifacts for debugging:

```bash
HIVE_E2E_KEEP_ARTIFACTS=1 bun run test:e2e:desktop
```

## Artifacts

- Published report: `apps/e2e-desktop/reports/latest/`
- Raw run artifacts (when kept): `tmp/e2e-desktop-runs/`

## Troubleshooting

- Electron launch failures on Linux: install all apt dependencies listed above.
- No display available in Linux CI/headless shells: run under `xvfb-run`.
