# Workspace Discovery & Switching

## Goal
Allow users to easily manage multiple workspaces and switch between them within Synthetic.

## Key Requirements
- On first launch, prompt the operator to choose a directory; if it contains a `synthetic.config.ts`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `synthetic.config.ts` and offer those as registrable workspaces.
- Persist registrations in a global workspace registry (e.g., `~/.synthetic/workspaces.json`) and surface all entries via the sidebar or command menu so switching is a single action.
- Switching workspaces updates the active repo context, constructs list, and services in-place.
- Because Synthetic runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Construct templates, histories, and artifacts remain isolated to their workspace; Synthetic never mixes constructs across projects.

## UX Requirements

### Constructs Dashboard
- **Simple list/table**: Present constructs showing name, current status, and template. Sorting/filtering by status or template is sufficient; avoid extra columns unless they prove useful.
- **Awaiting Input view**: Provide a dedicated "Awaiting Input" view accessible from the sidebar/command menu; within that route, show constructs blocking on feedback with quick links back to the main dashboard.
- **Minimal header**: Keep the page header minimal (logo, theme toggle, active workspace/project context). Surface navigation and create actions via a command menu so keyboard users can jump straight to constructs, creation flow, or workspace switching.
- **Inline navigation**: Prioritise inline links over inline mutations: from the dashboard let users jump directly to agent chat, diff review, or construct detail. Actions like mark complete can live in the construct page for clarity.

### Construct Detail Workspace
- **Hero section**: Summarises brief, owner, template used, current state, start/end timestamps, and quick action buttons (pause, terminate, escalate).
- **Organized sections**: Sections for agent chat entry point (with last message preview), running services (status, ports, open link buttons), diffs/changes (links into diff viewer), task metadata (acceptance criteria, related documents), and history timeline (state changes, human interactions).
- **Resume functionality**: If services or the agent need to be restarted after a host restart, surface a prominent "Resume construct" banner (with secondary options for services/agent individually) that triggers manifest replay so everything comes back online together.
- **Service controls**: For each service, show status plus quick actions: `Restart`, `Stop`, and a copy-to-clipboard button for the underlying command/env. No embedded shell; users can manually rerun the copied command in their own terminal if needed.
- **Navigation tabs**: Offer contextual navigation tabs or anchors (`Overview`, `Chat`, `Diffs`, `Services`) so the user can jump to the relevant payload quickly; remember scroll position if they return from another construct.