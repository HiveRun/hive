# GitHub Integration

- [ ] GitHub Integration #status/planned #phase-2 #feature/advanced

## Goal
Connect cells to GitHub workflows so work can start from arbitrary branches and sync back to pull requests.

## Key Requirements
- Allow selecting a non-main branch (or remote repo) when creating a cell; Hive should create the worktree from that base.
- Detect if the branch already has an open PR and display its status within the cell view.
- Provide helpers to open/update PRs when a cell completes (include plan summaries, diff highlights).
- Support copying a branch into a temporary worktree for experimentation without mutating the original branch.
