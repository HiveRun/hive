# Desktop WebDriver E2E

This package runs desktop smoke tests against a real Tauri binary using WebDriver (`tauri-driver`) + WebdriverIO.

## Local Setup

1. Run one-time workspace setup (includes best-effort desktop WebDriver prep):

```bash
bun setup
```

If you only want to rerun desktop setup, use:

```bash
bun run setup:desktop-e2e
```

2. Install Rust and Cargo if needed (see top-level setup docs).

3. If setup skipped driver installation (for example when Cargo was missing), install `tauri-driver` manually:

```bash
cargo install tauri-driver --locked
```

4. Ensure Cargo binaries are available in your shell:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

5. Linux only: install desktop/webkit dependencies:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  libssl-dev \
  patchelf \
  webkit2gtk-driver \
  xvfb
```

Tip: on Linux, the setup script automatically attempts to install missing packages via `sudo apt-get`.

## Run Tests

From repo root:

```bash
# Full desktop smoke suite
bun run test:e2e:desktop

# Single spec
bun run test:e2e:desktop:spec specs/smoke-launch.e2e.mjs
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

- `tauri-driver: command not found`: install via `cargo install tauri-driver --locked` and ensure `~/.cargo/bin` is on `PATH`.
- WebKit/GTK build failures on Linux: install all apt dependencies listed above.
- No display available in Linux CI/headless shells: run under `xvfb-run`.
