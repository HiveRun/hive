---
type: agent-instructions
---

# AI Agent Instructions

This folder contains specific instructions and context for AI agents working on this project.

## Workflow Notes
All planning lives in plain Markdown under `docs/`. Edit directly in VS Code (the Foam extension helps with wiki links) or any editor—no special rendering required. Focus on keeping frontmatter fields (`status`, `tags`) accurate so humans and agents share the same context.

## How to Use
1. Each task should reference a specific instruction document.
2. Instructions must be self-contained with all necessary context.
3. Use YAML frontmatter for machine-readable fields (`status`, `tags`).
4. Include at least one `theme-*` tag to group related work.
5. Link to related requirements and architecture decisions.

## Current Agent Tasks
Copy the handful of tasks currently assigned to agents from `docs/tasks/index.md` and list them here so the active queue is obvious.
- [ ] [[tasks/...]]
- [ ] [[tasks/...]]

