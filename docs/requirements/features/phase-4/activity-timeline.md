# Activity Timeline

- [ ] Activity Timeline #status/planned #phase-4 #feature/advanced

## Goal
Provide a chronological view of cell activity to help users understand what happened and when.

## Key Requirements
- Display a timeline of state changes, human interactions, and agent turns.
- Attach lightweight diff summaries to each agent turn (e.g., "+2 files / -10 lines") so reviewers can jump to that turn.
- When users click a timeline entry, recompute the diff for that past snapshot rather than relying on cached blobs.
- Show context switching aids: recent activity feed, saved filters, keyboard shortcuts, and status badging to help regain context quickly.
- Include notifications for when cells block on human input, finish, or encounter errors; include deep links.
- Support filtering by activity type (state changes, agent messages, user actions, service events).