# AGENTS

## E2E verification policy

- For user-facing changes (UI, navigation, auth flows, forms, dashboard interactions), run an end-to-end verification before considering the task complete.
- Use the `agent-browser` skill for browser checks where applicable.
- Resolve the frontend target in this order:
  1. Read `.env.dev.local` and use `FRONTEND_URL` when present.
  2. If `FRONTEND_URL` is missing, use `http://localhost:<FRONTEND_PORT>`.
  3. If neither is set, use the repo default frontend URL (`http://localhost:3001`) or the active Hive web service URL for the current cell.
- Run in headless mode by default.
- Use headed mode only when a human must participate (manual login, 2FA, CAPTCHA, explicit live verification).
- Save screenshots/videos to repo-local paths under `tmp/agent-browser/`.
- Include verification evidence in task responses (key outcomes and artifact paths).
- If E2E cannot run, explicitly state why and provide exact local reproduction steps.

## Handy commands

- `bun run ab:shot`
- `bun run ab:record:start`
- `bun run ab:record:stop`
- `bun run ab:latest`
- `bun run ab:latest:video`
