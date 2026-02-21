# Desktop Electron Migration

## Phase 0 - Planning and tracking
- [x] Create migration plan and execution checklist
- [x] Confirm rollout scope (full cutover) and platform target (macOS/Linux/Windows)

## Phase 1 - Electron runtime foundation
- [x] Add `apps/desktop-electron` package (main/preload/ipc)
- [x] Implement secure preload bridge for notifications and external links
- [x] Add desktop runtime type contract for web renderer

## Phase 2 - Runtime integration
- [x] Update CLI desktop launcher from Tauri resolution to Electron resolution
- [x] Replace Tauri detection in web runtime hooks and API base resolution
- [x] Update server CORS defaults for Electron desktop origin behavior

## Phase 3 - Build and packaging
- [x] Replace Tauri build/distribution pipeline with Electron packaging
- [x] Update installer distribution checks for Electron artifacts
- [x] Update workspace scripts/dependencies for Electron commands

## Phase 4 - Testing and CI
- [x] Replace desktop WebDriver harness with Playwright Electron harness
- [x] Update `scripts/dev/setup-desktop-e2e.sh` for Electron prerequisites
- [x] Update CI desktop jobs to build/test Electron desktop runtime

## Phase 5 - Cleanup and docs
- [x] Remove `src-tauri/` sources and legacy desktop-only configuration
- [x] Update README and prompt docs to Electron terminology and commands
- [x] Regenerate agent prompt bundle via `bun run ruler:apply`

## Open Follow-up
- [x] Stabilize desktop Playwright smoke specs (`smoke-launch` and `smoke-cell-chat`) for local xvfb runs
