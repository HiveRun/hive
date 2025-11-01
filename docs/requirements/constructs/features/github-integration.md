# GitHub Integration

## Goal
Connect constructs to GitHub workflows so work can start from arbitrary branches and sync back to pull requests.

## Key Requirements
- Allow selecting a non-main branch (or remote repo) when creating a construct; Synthetic should create the worktree from that base.
- Detect if the branch already has an open PR and display its status within the construct view.
- Provide helpers to open/update PRs when a construct completes (include plan summaries, diff highlights).
- Support copying a branch into a temporary worktree for experimentation without mutating the original branch.
