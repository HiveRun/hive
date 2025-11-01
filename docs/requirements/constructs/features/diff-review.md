# Diff Review

## Goal
Provide a comprehensive diff review experience within Synthetic so users can review agent changes without leaving the platform.

## Key Requirements
- Show a file tree grouped by status (modified/added/deleted) based on a fresh diff each time the panel opens.
- Render inline or side-by-side views using semantic output from Difftastic when available, with fallback to classic git diff.
- Clearly indicate the base commit the diff is computed against.
- Attach lightweight diff summaries to each agent turn (e.g., "+2 files / -10 lines") so reviewers can jump to that turn.
- When users click a historical diff entry, recompute the diff for that snapshot rather than relying on cached blobs.
- Support staging and reverting files through CLI/MCP helpers (`synthetic diff stage <construct> <path>`, `synthetic diff discard <construct> <path>`).
- Staging simply marks the change as acknowledged; rely on git to hold the actual file content.