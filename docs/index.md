---
tags: [index, home]
---

# Project Documentation

## Quick Links
- [[requirements/index|Requirements Overview]]
- [[tasks/index|Current Tasks]]
- [[architecture/index|Architecture Decisions]]
- [[agents/index|AI Agent Instructions]]

## Project Status
```dataview
TABLE status, priority, due_date
FROM "tasks"
WHERE status != "completed"
SORT priority DESC
LIMIT 10
```

## Recent Updates
```dataview
LIST
FROM ""
SORT created DESC
LIMIT 10
```

## Important Concepts
- [[concepts/core-concepts|Core Concepts]]
- [[workflows/development-workflow|Development Workflow]]
- [[architecture/system-overview|System Overview]]
