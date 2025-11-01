# Activity Timeline

## Goal
Provide a chronological view of construct activity to help users understand what happened and when.

## Key Requirements
- Display a timeline of state changes, human interactions, and agent turns.
- Attach lightweight diff summaries to each agent turn (e.g., "+2 files / -10 lines") so reviewers can jump to that turn.
- When users click a timeline entry, recompute the diff for that historical snapshot rather than relying on cached blobs.
- Show context switching aids: recent activity feed, saved filters, keyboard shortcuts, and status badging to help regain context quickly.
- Include notifications for when constructs block on human input, finish, or encounter errors; include deep links.
- Support filtering by activity type (state changes, agent messages, user actions, service events).