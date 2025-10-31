---
type: agent-view
---

# Current Agent Work

## High Priority Tasks
```dataview
TABLE status, due_date, file.link AS "Task"
FROM "tasks"
WHERE assigned_to = "agent" AND priority = "high"
SORT due_date ASC
```

## Requirements Ready for Implementation
```dataview
TABLE status, priority, file.link AS "Requirement"
FROM "requirements"
WHERE status = "approved" AND !completed
SORT priority DESC
```

## Blocked Tasks
```dataview
TABLE blocked_by, reason, file.link AS "Task"
FROM "tasks"
WHERE status = "blocked"
```
