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