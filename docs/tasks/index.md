# Tasks

## Open Tasks
```dataview
TABLE status, priority, due_date, file.link AS "Task"
FROM "tasks"
WHERE status != "completed"
SORT priority DESC
```
