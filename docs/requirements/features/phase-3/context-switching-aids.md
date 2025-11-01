# Context Switching Aids

## Goal
Help users quickly regain context when returning to constructs or switching between tasks.

## Key Requirements
- Recent activity feed showing the latest constructs and their states.
- Saved filters for common views (awaiting input, active, completed).
- Keyboard shortcuts for navigation and common actions.
- Status badging throughout the UI to indicate construct states at a glance.
- Quick links from dashboard to jump directly to agent chat, diff review, or construct detail.
- Remember scroll position and UI state when users return from another construct.
- Breadcrumbs showing navigation path and allowing quick back navigation.

## Shared UX Considerations
- **Notifications**: Trigger desktop/in-app (and optional Slack/webhook) alerts when constructs block on human input, finish, or encounter errors; include deep links.
- **Cross-feature integration**: Work seamlessly with Diff Review, Activity Timeline, and other construct features to provide a cohesive user experience.