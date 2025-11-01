# Construct UX Overview

This file covers the primary construct-oriented screens. Refer to [Agent Chat UX](agent-chat.md) for chat-specific behavior.

## Constructs Dashboard
- Present a simple list or table of constructs showing name, current status, and template. Sorting/filtering by status or template is sufficient; avoid extra columns unless they prove useful.
- Provide a dedicated "Awaiting Input" view accessible from the sidebar/command menu; within that route, show constructs blocking on feedback with quick links back to the main dashboard.
- Keep the page header minimal (logo, theme toggle, active workspace/project context). Surface navigation and create actions via a command menu so keyboard users can jump straight to constructs, creation flow, or workspace switching.
- Prioritise inline links over inline mutations: from the dashboard let users jump directly to agent chat, diff review, or construct detail. Actions like mark complete can live in the construct page for clarity.

## Construct Detail Workspace
- Hero section summarises brief, owner, template used, current state, start/end timestamps, and quick action buttons (pause, terminate, escalate).
- Sections for: agent chat entry point (with last message preview), running services (status, ports, open link buttons), diffs/changes (links into diff viewer), task metadata (acceptance criteria, related documents), and history timeline (state changes, human interactions).
- If services or the agent need to be restarted after a host restart, surface prominent “Resume services” / “Resume agent” banners that link to the manifest replay so the construct recovers quickly.
- Offer contextual navigation tabs or anchors (`Overview`, `Chat`, `Diffs`, `Services`) so the user can jump to the relevant payload quickly; remember scroll position if they return from another construct.

## Construct Creation Flow
- Stepper/form that walks through template selection, task metadata (name, description, acceptance criteria), optional canned responses, and service adjustments (enable/disable, override ports/env where allowed).
- Display template-provided defaults alongside editable fields, with inline hints pulled from template metadata (e.g., expected services, required env vars).
- Show a summary review step confirming services that will start, initial prompt/context that will be sent to the agent, and any missing credentials/config that must be resolved before creation.
- Provide autosave/draft so long forms can be resumed, and validations that highlight missing fields before submission.

## Shared UX Considerations
- **Notifications**: Trigger desktop/in-app (and optional Slack/webhook) alerts when constructs block on human input, finish, or encounter errors; include deep links.
- **Diff Review**: Provide inline/side-by-side diff viewer with file tree, syntax highlighting, quick accept/reject controls, and comment threads without leaving Synthetic.
- **Context Switching Aids**: Recent activity feed, saved filters, keyboard shortcuts, and status badging to help regain context quickly.
