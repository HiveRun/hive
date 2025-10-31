---
type: agent-instructions
---

# AI Agent Instructions

This folder contains specific instructions and context for AI agents working on this project.

## How to Use
1. Each task should reference a specific instruction document.
2. Instructions should be self-contained with all necessary context.
3. Use YAML frontmatter for machine-readable configuration.
4. Link to related requirements and architecture decisions.

## Current Agent Tasks
```dataview
TABLE status, assigned_to, priority
FROM "tasks"
WHERE assigned_to = "agent"
SORT priority DESC
```
