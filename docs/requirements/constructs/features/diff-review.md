# Diff Review

## Goal
Provide a comprehensive diff review experience within Synthetic so users can review agent changes without leaving the platform.

## Key Requirements
- Show a file tree grouped by status (modified/added/deleted) based on a fresh diff each time the panel opens.
- Render inline or side-by-side views using semantic output from Difftastic when available, with fallback to classic git diff.
- Clearly indicate the base commit the diff is computed against.
- **Dual diff modes**: Allow toggling between:
  1. **Branch diff**: From branch base (e.g., main) to current state
  2. **Uncommitted diff**: From current state to staged changes
