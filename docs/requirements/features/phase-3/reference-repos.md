# Reference Repositories

- [ ] Reference Repositories #status/planned #phase-3 #feature/advanced

## Goal
Let constructs attach remote repositories as read-only references so agents and humans can inspect external code while planning or implementing.

## Key Requirements
- Allow specifying additional Git repositories (with commit/branch) to clone into a read-only location within the workspace.
- Expose these references to the agent prompt/context and link them in the UI.
- Avoid mixing reference code with the construct worktree to prevent accidental edits.
- Provide lifecycle management (clone on demand, prune when construct completes).
