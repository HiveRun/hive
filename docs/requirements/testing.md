# Testing Strategy

This document outlines our approach to testing Synthetic across constructs and supporting services.

## Philosophy
- Prefer pure functions; when code needs IO helpers, accept only the specific helper you want to swap. For standard modules (`fs`, `path`, `Bun.spawn`), import them directly and use `vi.mock`/`vi.spyOn` in tests when necessary.
- Use real behavior whenever it’s safe: temp directories via `fs.mkdtemp`, short-lived processes, and stub commands. Avoid blanket mocks—mock only when an external dependency can’t be safely exercised or would make tests flaky.
- Every test that touches the host (files, services, ports) must clean up via `finally` blocks to keep the developer’s machine stable.
- Surface errors directly. Tests can assert on the error payload in the view layer; no special retry logic needed.

## Unit Layer
- Use Vitest to cover pure functions (config parsing, prompt assembly, port allocator). Import built-ins directly and rely on `vi.mock`/`vi.spyOn` when a call needs to be faked.
- Only accept explicit dependency arguments for things like the OpenCode client where we truly need to swap implementations.

## Integration Layer
- Provide a test harness that spins up isolated temp workspaces, fake agents, and stubbed service runners. Harness must create/clean git worktrees, assign ephemeral ports, and ensure all processes are terminated even on failure.
- Implement a mock OpenCode SDK/server shim that reproduces session lifecycle, message streaming, and auth failures. Use it in integration tests so we never hit real LLMs during CI.
- Tests should set `SYNTHETIC_TEST_MODE` (or equivalent) so service commands run lightweight stubs, docker invocations are replaced with no-ops, and resource limits prevent runaway processes. All writes happen under a temp root (e.g., `/tmp/synthetic-test-*`).

## Visual Regression (Playwright)
- Browser automation lives under `apps/web/e2e/` and serves as a **visual regression harness** rather than a pure end-to-end suite. Specs hit the real router, but critical API calls are intercepted with deterministic fixtures so screenshots remain stable.
- Shared fixture builders live in `apps/web/e2e/utils/`, use seeded Faker, and are typed via the Eden/TanStack query client (which mirrors our Elysia TypeBox schemas). Update those helpers when the backend contract changes—never hand-roll JSON per spec.
- If we need fully integrated journeys, layer a separate suite that seeds the db instead of stubbing HTTP; keep the current visual harness focused on pixel diffs.

## Smoke & Visual Regression
- Maintain a small set of Playwright specs and CLI smoke tests that exercise construct creation, review queue, and transcript rendering. Keep them fast and run on nightly/release pipelines.

## CI Tiers
- Run unit tests and lint on every push.
- Run integration tests on PRs (matrix per OS).
- Run smoke/E2E nightly. Failures must display clear cleanup instructions so the developer’s machine isn’t left in a bad state.
