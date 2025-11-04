# Agent Orchestration Engine

- [ ] Agent Orchestration Engine #status/planned #phase-0 #feature/core

## Goal
Provide the core engine for managing agent sessions, authentication, and lifecycle events across all construct types.

## Requirements

### Core Engine
- Prefer the published `@opencode-ai/sdk` for all agent interactions and fall back to the mock orchestrator automatically in development or when credentials are unavailable.
- Run constructs directly in the host environment so agents share the user's credentials, PATH, and tooling; pods or containers are out of scope for Phase 0.
- Track agent state transitions (starting, working, awaiting input, completed, error) and persist them so the UI can resume interrupted sessions.
- Persist every agent message to SQLite and expose an API for fetching transcripts.
- Emit status updates to the construct layer so UI components can reflect the active/awaiting/completed lifecycle.

## UX Requirements

### Agent Chat Interface
- Present a chronological transcript of system, user, and agent messages with lightweight formatting.
- Automatically scroll to the most recent message after the user sends input or when new responses arrive.
- Keep the composer contents intact across navigation and provide a dedicated "Clear" action so the user decides when to discard drafts.

### Input Controls
- Require `⌘ + Enter` / `Ctrl + Enter` to send. Plain `Enter` inserts a newline and keeps focus in the composer.
- Provide primary actions to start and stop the agent; stopping should leave the transcript and draft input intact.

### Responsive Layout
- Keep transcript and composer in the primary column and surface service status in the secondary column. Ensure the layout remains usable on desktop and tablet breakpoints; mobile optimization is a future enhancement.

## Implementation Details

### Session Management
- Initialize sessions with the OpenCode SDK when credentials are present and transparently fall back to the mock orchestrator in local/test environments.
- Attach status and message listeners so state changes and transcripts are written to SQLite.
- Allow interrupted sessions to be resumed by reading the latest transcript and stored status.

### Persistence
- Store agent sessions, transcripts, and prompt bundles in SQLite with second-level timestamps.
- Provide helper functions for inserting new messages and listing transcripts by session.
- Keep construct status in sync with agent activity (active, awaiting input, completed, error).

### Event Handling
- Propagate status transitions to the construct layer so UI components can react without additional polling.
- Tolerate orchestrator errors by marking sessions as errored while leaving existing transcripts intact.

## Integration Points
- **Persistence Layer**: Stores session state, transcripts, and artifacts
- **Construct Creation/Provisioning**: Receives provisioned construct and assembled prompt for session initialization
- **Prompt Assembly Pipeline**: Provides the composed agent brief
- **Configuration Validation**: Ensures templates have required agent configuration

## Testing Strategy
- Test session creation, message exchange, and termination flows via the mock orchestrator.
- Verify transcript persistence and API responses for listing messages and sessions.
- Ensure construct status updates reflect agent progress (active → awaiting input → completed/error).
- Exercise chat UI interactions: sending with keyboard shortcut, clearing drafts, stopping the agent, and resuming an existing transcript.
