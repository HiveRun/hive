# Sparse Constructs

## Goal
Allow launching constructs that run an agent without provisioning the full service stack, useful for lightweight planning or research tasks.

## Key Requirements
- Skip service provisioning while still creating an isolated worktree.
- Clarify limitations in the UI (no live backend/frontend services available).
- Permit later conversion into a full construct (provision services and resume implementation).
- Ensure diff/prompt workflows still function in sparse mode.
