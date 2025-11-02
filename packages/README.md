# Synthetic Packages

This directory contains the core packages that power the Synthetic platform.

## Phase 0 Infrastructure Packages

### @synthetic/config
Type-safe configuration system for defining construct templates and workspace settings.

**Features:**
- TypeScript type definitions for templates and services
- Zod-based validation for runtime safety
- Support for process, Docker, and Docker Compose services
- Port management and environment variable configuration

### @synthetic/prompts
Prompt assembly pipeline for building agent context from multiple sources.

**Features:**
- Glob pattern resolution for prompt sources
- Configurable prompt ordering
- Variable substitution and context injection
- Token estimation
- Heading deduplication

### @synthetic/db
SQLite-based persistence layer with Drizzle ORM.

**Features:**
- Normalized schema for constructs, sessions, transcripts, and artifacts
- Repository pattern for common operations
- ACID guarantees with SQLite + WAL mode
- Support for both memory and file-based databases

### @synthetic/agent
Agent orchestration system for managing OpenCode sessions.

**Features:**
- Abstract interface for agent sessions
- Mock orchestrator for development and testing
- Event-based status and message notifications
- Ready for OpenCode SDK integration

### @synthetic/constructs
High-level construct provisioning and lifecycle management.

**Features:**
- Automated port allocation with conflict detection
- Workspace directory setup
- Prompt bundle assembly and context injection
- Agent session initialization
- Integration of all Phase 0 packages

## Development

Each package is independently testable and buildable:

```bash
# Install dependencies
bun install

# Run tests for a package
cd packages/<package-name>
bun run test

# Build a package
bun run build

# Run all tests
bun run test:run  # from repo root
```

## Architecture

The packages form a layered architecture:

```
@synthetic/constructs
  ├── @synthetic/agent
  ├── @synthetic/prompts
  │   └── @synthetic/config
  ├── @synthetic/db
  │   └── @synthetic/config
  └── @synthetic/config
```

- **config**: Foundation layer with type definitions
- **prompts** & **db**: Independent feature layers
- **agent**: Service layer for external integration
- **constructs**: Orchestration layer tying everything together

## Testing Philosophy

- **Config, Prompts, DB**: Comprehensive unit tests with real file system operations
- **Agent**: Mock implementation with interface contracts
- **Constructs**: Integration tests combining all packages

Tests use temporary directories and clean up after themselves to avoid polluting the file system.
