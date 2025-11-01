# Workspace Discovery & Switching

- [ ] Workspace Discovery & Switching #status/planned #phase-1 #feature/ux

## Goal
Allow users to easily manage multiple workspaces and switch between them within Synthetic.

## Requirements

### Workspace Discovery
- On first launch, prompt for operator to choose a directory; if it contains a `synthetic.config.ts`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `synthetic.config.ts` and offer those as registrable workspaces.
- Persist registrations in a global workspace registry (e.g., `~/.synthetic/workspaces.json`) and surface all entries via a sidebar or command menu so switching is a single action.

### Workspace Switching
- Switching workspaces updates the active repo context, constructs list, and services in-place.
- Because Synthetic runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Construct templates, histories, and artifacts remain isolated to their workspace; Synthetic never mixes constructs across projects.
- Fast switching with minimal application restart or state reload.

### Workspace Management
- Add/remove workspaces from the registry
- Edit workspace names and descriptions
- Validate workspace configurations during registration
- Handle workspace path changes and missing directories

## UX Requirements

### Workspace Selection Interface
- **Workspace browser**: Visual interface for browsing and selecting workspaces
- **Quick switch**: One-click workspace switching from sidebar or command palette
- **Workspace status**: Show current workspace and available alternatives
- **Search and filter**: Find workspaces by name or path

### Constructs Dashboard
- **Simple list/table**: Present constructs showing name, current status, and template. Sorting/filtering by status or template is sufficient; avoid extra columns unless they prove useful.
- **Awaiting Input view**: Provide a dedicated "Awaiting Input" view accessible from sidebar/command menu; within that route, show constructs blocking on feedback with quick links back to the main dashboard.
- **Minimal header**: Keep the page header minimal (logo, theme toggle, active workspace/project context). Surface navigation and create actions via a command menu so keyboard users can jump straight to constructs, creation flow, or workspace switching.
- **Inline navigation**: Prioritise inline links over inline mutations: from the dashboard let users jump directly to agent chat, diff review, or construct detail. Actions like mark complete can live in the construct page for clarity.

### Workspace Management UI
- **Registration flow**: Step-by-step workspace registration with validation
- **Settings panel**: Edit workspace properties and configurations
- **Import/export**: Backup and restore workspace registry
- **Cleanup tools**: Remove invalid or unused workspace entries

## Implementation Details

### Workspace Registry
- Global workspace storage in JSON format
- Workspace validation and configuration checking
- Path resolution and normalization
- Registry migration and versioning

### Switching Engine
- Context switching logic and state management
- Port allocation coordination across workspaces
- Service lifecycle management during switches
- Data isolation and cleanup procedures

### Discovery System
- Directory scanning and workspace detection
- Configuration file validation
- Automatic workspace registration
- Conflict resolution for duplicate entries

## Integration Points
- **All Features**: Workspace context affects all feature behavior
- **Persistence Layer**: Stores workspace registry and metadata
- **Template Definition System**: Loads templates from active workspace
- **Agent Orchestration Engine**: Manages constructs within workspace context

## Testing Strategy
- Test workspace discovery and registration workflows
- Verify workspace switching and context updates
- Test port allocation coordination across workspaces
- Validate data isolation between workspaces
- Test workspace management UI and registry operations
- Performance testing with many workspaces and large projects

## Testing Strategy
*This section needs to be filled in with specific testing approaches for workspace switching functionality.*

### Construct Detail Workspace
- **Hero section**: Summarises brief, owner, template used, current state, start/end timestamps, and quick action buttons (pause, terminate, escalate).
- **Organized sections**: Sections for agent chat entry point (with last message preview), running services (status, ports, open link buttons), diffs/changes (links into diff viewer), task metadata (acceptance criteria, related documents), and history timeline (state changes, human interactions).
- **Resume functionality**: If services or the agent need to be restarted after a host restart, surface a prominent "Resume construct" banner (with secondary options for services/agent individually) that triggers manifest replay so everything comes back online together.
- **Service controls**: For each service, show status plus quick actions: `Restart`, `Stop`, and a copy-to-clipboard button for the underlying command/env. No embedded shell; users can manually rerun the copied command in their own terminal if needed.
- **Navigation tabs**: Offer contextual navigation tabs or anchors (`Overview`, `Chat`, `Diffs`, `Services`) so the user can jump to the relevant payload quickly; remember scroll position if they return from another construct.