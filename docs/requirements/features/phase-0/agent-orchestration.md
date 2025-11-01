# Agent Orchestration Engine

## Goal
Provide the core engine for managing agent sessions, authentication, and lifecycle events across all construct types.

## Key Requirements
- Anchor on the official OpenCode SDK for all agent interactions (init sessions, send prompts, stream tool events, fetch artifacts). Avoid TUI screen scraping.
- Keep a local clone of <https://github.com/sst/opencode> in `vendor/opencode/` for reference only; production code must depend on the published `@opencode-ai/sdk` package, never the clone.
- Run constructs directly in the host environment so agents share the user's credentials, PATH, and dependencies; no supervised pods for v1.
- Before creating an OpenCode session, inspect the user's OpenCode config/auth store (`auth.json`) to confirm credentials exist for the provider the template demands; if missing, block the session and prompt the user to run `opencode auth login` (no additional runtime retries beyond surfacing the error toast).
- Assemble each agent session prompt from a base Markdown primer describing Synthetic, constructs, and the agent's role; append construct-specific context (task brief, running services, resolved ports/URLs, constraints on external resources).
- Handle agent state transitions (starting, working, awaiting input, completed, error) and emit events for the UI to consume.
- Stream agent tool events and responses in real-time to the UI for live progress tracking.
- Manage agent session persistence and recovery, allowing constructs to be resumed after interruptions.
- Provide hooks for the persistence layer to store transcripts and artifacts as they're generated.

## Integration Points
- **Persistence Layer**: Stores session state, transcripts, and artifacts
- **Planning-to-Implementation Handoff**: Handles transitions between construct types
- **Prompt Assembly Pipeline**: Provides the composed agent brief
- **Configuration Validation**: Ensures templates have required agent configuration

## UX Requirements

### Agent Chat Interface
- **Simple transcript**: Chronological stream of user and agent messages—no special tooling visualization yet. Focus on reliable text display first. Planning constructs show plan submissions as dedicated system messages (with links to the rendered plan); manual constructs skip this view entirely.
- **Stable scrolling**: Preserve scroll position when messages send/arrive and across refresh/navigation. Display a down-arrow indicator whenever the user is not at the bottom—even with no new messages—so they can jump back to the latest on demand.
- **Message states**: Highlight aborted/failed messages with a subtle status tag and muted styling so users can see where the agent stopped. Successful messages stay visually consistent.
- **Persistent composer**: Keep the input contents intact across refresh/navigation. Provide an explicit "Clear input" action so the user controls when drafts are discarded.
- **Sending shortcut**: Require `⌘ + Enter` / `Ctrl + Enter` to send. Plain `Enter` inserts a newline; indicate the shortcut directly in the UI and keep focus in the composer after sending.
- **Interruptions**: Expose an Abort button and bind `Esc` to the same action so the user can cancel the agent quickly without losing draft text or scroll position. After a restart, show a "Resume agent" banner prompting the user to rehydrate context before sending new input.
- **Canned replies**: Allow user-defined quick responses (chips/buttons) that insert preset text into the composer without auto-sending. Provide a simple manage/edit affordance (e.g., overflow menu linking to settings) so users can update canned text without leaving the construct.
- **Layout basics**: Keep transcript and composer in the main column with any context/service panels in a secondary column that collapses into tabs on smaller screens. Ensure the down-arrow indicator and canned responses adapt in responsive layouts.