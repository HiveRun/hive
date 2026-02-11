# Workspace Discovery & Switching

- [x] Workspace Discovery & Switching #status/in-progress #phase-1 #feature/ux
  - [x] [HIVE-10] Add copy-to-clipboard OpenCode CLI command to cell detail view
  - [x] Add a per-cell `Terminal` route with an interactive PTY shell bound to the cell workspace
  - [x] Replace setup/service log viewers with PTY-backed terminals (no filesystem log persistence)
  - [x] Add keyboard input forwarding for setup/service PTY terminals
  - [x] Replace custom chat renderer with an OpenCode-attached PTY route while keeping `/cells/$id/terminal` as a shell escape hatch
  - [x] Attempt OpenCode CLI installation during Hive installer flow when missing
  - [x] Add regression tests for sidebar status SSE stream behavior on `/api/agents/sessions/:id/events`
  - [x] Apply a Hive-branded OpenCode theme automatically for embedded chat terminals
  - [x] Add light-mode support for the embedded Hive OpenCode theme and sync it from the web theme selection
  - [x] Keep chat loading overlay visible until OpenCode renders terminal content
  - [x] Add true runtime E2E coverage for registering a second workspace and validating workspace-scoped cell isolation
  - [x] Add true runtime E2E coverage for `/cells/$id/terminal` route input/restart behavior
  - [x] Add true runtime E2E coverage for `/cells/$id/terminal` refresh reconnect behavior

## Goal
Allow users to easily manage multiple workspaces and switch between them within Hive.

## Requirements

### Workspace Discovery
- Start with explicit registration: expose an "Add workspace" flow (and CLI equivalent) where the operator selects directories to track. Automatic detection is limited to the directory Hive is currently running from so we avoid scanning the entire disk.
- On first launch, prompt for operator to choose a directory; if it contains a `hive.config.json`, register it immediately.
- When a directory contains multiple subdirectories, scan only the immediate children for `hive.config.json` and offer those as registrable workspaces.
- Persist registrations in a global workspace registry (e.g., `~/.hive/workspaces.json`) and surface all entries via a sidebar or command menu so switching is a single action.
- Registration UI includes an inline directory explorer with search/filter, so users can browse the filesystem without leaving Hive; selected folders automatically use their directory name as the workspace label.

### Workspace Switching
- Switching workspaces updates the active repo context, cells list, and services in-place.
- Because Hive runs as a single instance, it can coordinate port assignments and avoid collisions automatically.
- Cell templates, histories, and artifacts remain isolated to their workspace; Hive never mixes cells across projects.
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

### Cells Dashboard
- **Simple list/table**: Present cells showing name, current status, and template. Sorting/filtering by status or template is sufficient; avoid extra columns unless they prove useful.
- **Awaiting Input view**: Provide a dedicated "Awaiting Input" view accessible from sidebar/command menu; within that route, show cells blocking on feedback with quick links back to the main dashboard.
- **Minimal header**: Keep the page header minimal (logo, theme toggle, active workspace/project context). Surface navigation and create actions via a command menu so keyboard users can jump straight to cells, creation flow, or workspace switching.
- **Inline navigation**: Prioritise inline links over inline mutations: from the dashboard let users jump directly to agent chat, diff review, or cell detail. Actions like mark complete can live in the cell page for clarity.

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
- API/CLI hooks for manual add/remove plus auto-registration of the workspace Hive is currently running from.

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

### Runtime Integration
- Workspace context, plugins, and removal flows rely on `WorktreeManagerService` via `runServerEffect` so worktree lifecycle stays inside Effect layers.

## Integration Points
- **All Features**: Workspace context affects all feature behavior
- **Persistence Layer**: Stores workspace registry and metadata
- **Template Definition System**: Loads templates from active workspace
- **Agent Orchestration Engine**: Manages cells within workspace context

## Testing Strategy
- Test workspace discovery and registration workflows
- Verify workspace switching and context updates
- Test port allocation coordination across workspaces
- Validate data isolation between workspaces
- Test workspace management UI and registry operations
- Performance testing with many workspaces and large projects

## Testing Strategy
*This section needs to be filled in with specific testing approaches for workspace switching functionality.*

### Cell Detail Workspace
- **Hero section**: Summarises brief, owner, template used, current state, start/end timestamps, and quick action buttons (pause, terminate, escalate).
- **Organized sections**: Sections for agent chat entry point (with last message preview), running services (status, ports, open link buttons), diffs/changes (links into diff viewer), task metadata (acceptance criteria, related documents), and history timeline (state changes, human interactions).
- **Resume functionality**: If services or the agent need to be restarted after a host restart, surface a prominent "Resume cell" banner (with secondary options for services/agent individually) that triggers manifest replay so everything comes back online together.
  - **Service controls**: For each service, show status plus quick actions: `Restart`, `Stop`, and a copy-to-clipboard button for the underlying command/env. Pair this with a dedicated `Terminal` route so operators can run ad-hoc commands inside the cell worktree.
  - **OpenCode CLI escape hatch**: Each cell card in the workspace list must surface the exact `opencode` command (workspace path, session ID, host, and port) with a copy-to-clipboard action so operators can jump into the TUI immediately without opening the chat route.
  - **Navigation tabs**: Offer contextual navigation tabs or anchors (`Overview`, `Chat`, `Diffs`, `Services`, `Terminal`) so the user can jump to the relevant payload quickly; remember scroll position if they return from another cell.
