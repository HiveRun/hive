# Phase 0 PR Sequence

This document outlines the sequential PR strategy for Phase 0 implementation.

## Strategy Overview

**Approach**: Each PR is focused, reviewable (200-400 LOC), and includes only the persistence layer it needs.

**Key Principle**: Persistence grows organically—we don't build the full schema upfront. Each PR adds tables/queries as needed.

---

## PR #1: Template Definition System ✅ **COMPLETED**

**Branch**: `feat/template-definition-system`

### Scope
- TypeScript config schema (`synthetic.config.ts`)
- `defineSyntheticConfig()` function with full type safety
- Template validation and type checking
- Basic template browser/listing in UI

### Persistence Added
- **File-based storage**: Templates stored in `synthetic.config.ts` (intentional architectural decision)
- No database tables for templates (prioritizes version control and type safety)
- Elysia RPC endpoint for template loading from config files

### Tests
- Template schema validation
- TypeScript type checking
- Template loading from config files
- UI rendering of template list
- E2E tests for templates page

### Acceptance Criteria
- [x] Can define templates in `synthetic.config.ts` with intellisense
- [x] Templates validate at compile time
- [x] UI can list available templates
- [x] Tests pass with real template data
- [x] File-based approach provides version control benefits
- [x] E2E tests cover templates page functionality

---

## PR #2: Prompt Assembly Pipeline

**Branch**: `feat/prompt-assembly-pipeline`

### Scope
- Prompt source resolution (files, globs, ordering)
- Variable substitution (`${constructId}`, `${workspaceName}`)
- Context injection (services, ports, environment)
- Bundle generation and token estimation
- Markdown concatenation with deduplication

### Persistence Added
- `prompt_bundles` table (id, construct_id, content, token_count, created_at)
- Query to fetch latest bundle for a construct

### Tests
- Glob pattern resolution
- Variable substitution logic
- Token estimation accuracy
- Bundle generation with mock templates

### Dependencies
- PR #1 (needs template definitions)

### Acceptance Criteria
- [ ] Can resolve prompt sources from config
- [ ] Variables substitute correctly
- [ ] Token counts are accurate
- [ ] Bundles store in database

---

## PR #3: Workspace & Construct Lifecycle

**Branch**: `feat/workspace-construct-lifecycle`

### Scope
- Create `.constructs/<id>` directories
- Construct CRUD operations (create, list, delete)
- Basic construct status (draft, provisioning, ready, error)
- Construct creation form UI
- Construct listing page UI

### Persistence Added
- `constructs` table (id, name, description, template_id, workspace_path, status, created_at, updated_at)
- Queries: list constructs, get by id, update status, delete cascade

### Tests
- Directory creation and cleanup
- Construct CRUD operations
- Status transitions
- UI form validation

### Dependencies
- PR #1 (needs templates for construct creation)

### Acceptance Criteria
- [ ] Can create construct with name/description
- [ ] Workspace directory created at `.constructs/<id>`
- [ ] Construct status tracked in database
- [ ] UI shows construct list with status

---

## PR #4: Port Allocation System

**Branch**: `feat/port-allocation-system`

### Scope
- OS-level port probing (avoid collisions)
- Port allocation strategy (preferred → fallback)
- Port reservation tracking
- Utility functions for claiming/releasing ports

### Persistence Added
- `port_allocations` table (id, construct_id, service_name, port, allocated_at)
- Queries: allocate port, release port, list by construct

### Tests
- Port probing with mock OS calls
- Allocation strategy with preferred ports
- Port reservation and release
- Conflict resolution

### Dependencies
- PR #3 (needs constructs to allocate ports for)

### Acceptance Criteria
- [ ] Can probe OS for free ports
- [ ] Preferred ports used when available
- [ ] Port allocations tracked per construct
- [ ] Ports released on construct cleanup

---

## PR #5: Service Management & Process Lifecycle

**Branch**: `feat/service-management`

### Scope
- Parse service definitions from templates
- Spawn child processes with `child_process.spawn`
- Environment variable injection (including allocated ports)
- Ready pattern detection (stdout/stderr scanning)
- Graceful shutdown and cleanup
- Service status transitions

### Persistence Added
- `services` table (id, construct_id, name, type, command, cwd, env_json, pid, status, ready_pattern, started_at, stopped_at)
- Queries: create service, update status, list by construct, cleanup

### Tests
- Service parsing from templates
- Process spawning with mock commands
- Environment variable injection
- Ready pattern detection
- Graceful shutdown

### Dependencies
- PR #1 (needs template service definitions)
- PR #3 (needs constructs to attach services to)
- PR #4 (needs allocated ports for env injection)

### Acceptance Criteria
- [ ] Can parse services from template config
- [ ] Processes spawn with correct environment
- [ ] Ready patterns detect service startup
- [ ] Services shutdown gracefully
- [ ] Service status tracked in database

---

## PR #6: Provisioning Orchestration

**Branch**: `feat/provisioning-orchestration`

### Scope
- Wire together workspace + ports + services + prompts
- Multi-step provisioning flow with rollback on failure
- Provision API endpoint that coordinates everything
- Error handling and cleanup on failed provisioning
- Provision progress tracking

### Persistence Updates
- Update `constructs` status through provisioning stages
- Link constructs → services → ports → prompt_bundles

### Tests
- Full provisioning flow integration test
- Rollback on failure scenarios
- Error handling paths
- Cleanup on abort

### Dependencies
- PR #2 (needs prompt assembly)
- PR #3 (needs workspace creation)
- PR #4 (needs port allocation)
- PR #5 (needs service management)

### Acceptance Criteria
- [ ] Can provision full construct from template
- [ ] Workspace + ports + services + prompt all created
- [ ] Rollback works on failure
- [ ] Construct status reflects provisioning progress
- [ ] Integration tests pass end-to-end

---

## PR #7: OpenCode Agent Integration

**Branch**: `feat/opencode-agent-integration`

### Scope
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and state management
- Session lifecycle (create, send, receive, stop)
- Credential validation from OpenCode config

### Persistence Added
- `agent_sessions` table (id, construct_id, provider, status, started_at, completed_at)
- `agent_messages` table (id, session_id, role, content, timestamp)

### Tests
- Session creation with mock orchestrator
- Message streaming
- State transitions
- Credential validation
- Fallback to mock when no credentials

### Dependencies
- PR #6 (needs provisioned constructs to run agents in)

### Acceptance Criteria
- [ ] Can create OpenCode session with SDK
- [ ] Messages stream in real-time
- [ ] Mock orchestrator works without credentials
- [ ] Session state tracked in database
- [ ] Transcripts persist to database

---

## PR #8: Agent Orchestration Engine (UI + Glue)

**Branch**: `feat/agent-orchestration-ui`

### Scope
- Chat interface components (transcript, composer)
- Keyboard shortcuts (Cmd+Enter to send, Esc to abort)
- Status updates and lifecycle visualization
- Scroll position management
- Draft persistence across navigation
- Wiring together constructs + agents + UI

### Persistence Updates
- `composer_drafts` table (optional, for persisting draft input)
- UI state preferences (scroll position, etc.)

### Tests
- Chat UI component tests
- Keyboard shortcut handling
- Scroll position preservation
- Draft persistence
- E2E tests for complete construct lifecycle

### Dependencies
- PR #7 (needs agent integration to orchestrate)

### Acceptance Criteria
- [ ] Chat interface renders transcript
- [ ] Cmd+Enter sends messages
- [ ] Esc aborts agent
- [ ] Scroll position preserved
- [ ] Draft input persists across refresh
- [ ] E2E tests pass for full workflow

---

## Summary Timeline

```
PR #1 (Templates)
  ↓
PR #2 (Prompts)
  ↓
PR #3 (Workspace) ────→ PR #4 (Ports)
         ↓                    ↓
         └──────→ PR #5 (Services)
                       ↓
                 PR #6 (Provisioning)
                       ↓
                 PR #7 (Agent SDK)
                       ↓
                 PR #8 (UI + Orchestration)
```

Each PR is approximately 200-400 LOC and takes 1-3 days to complete including tests and review.

Total estimated timeline: **3-4 weeks** for Phase 0 completion.
