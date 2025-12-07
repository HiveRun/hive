# Phase 0 PR Sequence (Rescoped)

This document outlines the sequential PR strategy for Phase 0 implementation, **rescoped to focus on core functionality that delivers value quickly**.

## Strategy Overview

**Approach**: Each PR is focused, reviewable (200-400 LOC), and includes only the persistence layer it needs.

**Key Principle**: Persistence grows organically—we don't build the full schema upfront. Each PR adds tables/queries as needed.

## Rescope Decision

**New Focus**: Worktrees, OpenCode integration, and base cell capabilities
**Deferred**: Service management, port allocation, complex provisioning orchestration

**Rationale**: To get Hive useful quickly, we need:
1. ✅ Template definitions (completed)
2. 🔄 Git worktree management for isolated workspaces  
3. 🔄 OpenCode SDK integration for agent sessions
4. 🔄 Basic cell lifecycle (create, list, status)

**Note**: All schemas, validation, and tests from the original plan remain in place but are marked as **PREPARED BUT NOT CURRENTLY USED** to enable faster implementation of the core path.

---

## Step 1: Template Definition System ✅ **COMPLETED**

**Branch**: `feat/template-definition-system`

### Scope
- JSON/JSONC config schema (`hive.config.jsonc` / `hive.config.json`)
- Runtime validation with Zod (optional `defineHiveConfig()` helper for TypeScript configs)
- Template validation and type checking
- Basic template browser/listing in UI

### Persistence Added
- **File-based storage**: Templates stored in `hive.config.jsonc` or `hive.config.json` (intentional architectural decision; TypeScript configs remain compatible for development)
- No database tables for templates (prioritizes version control and type safety)
- Elysia RPC endpoint for template loading from config files

### Tests
- Template schema validation
- TypeScript type checking
- Template loading from config files
- UI rendering of template list
- E2E tests for templates page

### Acceptance Criteria
- [x] Can define templates in `hive.config.jsonc` (or `hive.config.json`) with runtime validation
- [x] Templates validate at compile time
- [x] UI can list available templates
- [x] Tests pass with real template data
- [x] File-based approach provides version control benefits
- [x] E2E tests cover templates page functionality

---

## Step 2: Basic Cell Management ✅ **COMPLETED**

**Branch**: `feat/basic-cell-management`

### Scope
- Cell creation form UI (name, description, template selection)
- Cell listing page
- **Real database persistence** for basic cells
- Cell CRUD operations (create, list, delete, update)
- **No status tracking, no worktree, no services, no agents** - just basic cell entities

### Persistence Added
- `cells` table (id, name, description, template_id, created_at, updated_at)
- **Note**: workspace_path and status added later in PR #3
- Queries: create, list, get by id, delete, update

### Tests
- Cell creation form validation
- Database CRUD operations
- UI component tests with real data
- E2E tests for complete cell management workflow
- [x] Playwright snapshots mock API responses with deterministic Faker fixtures

### Dependencies
- Step 1 (needs templates for cell creation form)

### Acceptance Criteria
- [x] Can create cell via UI form with real database storage
- [x] Cell list shows basic info from database
- [x] Can delete cells from UI and database
- [x] Can bulk delete cells from UI and database
- [x] Can update cell details (name, description)
- [x] E2E tests pass for full cell management workflow
- [x] Database schema ready for worktree extension in PR #3

---

## Step 3: Git Worktree Integration ✅ **COMPLETED**

**Branch**: `feat/git-worktree-integration`

### Scope
- **Extend existing cells** with git worktree functionality
- Add `workspace_path` to existing cells
- Create isolated git worktrees for each cell (`.cells/<id>/`)
- Worktree lifecycle management (create, list, prune, cleanup)
- Worktree isolation and safety checks
- **Extend existing UI** from Step 2 to show worktree information

### Persistence Updates
- **ALTER TABLE cells ADD COLUMN workspace_path TEXT**
- Update existing cells to support worktree paths
- Migration script to add workspace_path column

### Tests
- Git worktree creation and cleanup
- Database migration testing
- Worktree isolation verification
- **Integration tests with existing UI from Step 2**

### Dependencies
- Step 1 (needs templates for cell creation)
- Step 2 (needs existing cell management)

### Acceptance Criteria
- [x] Existing cells can be extended with worktree functionality
- [x] Worktree created at `.cells/<id>/` when requested
- [x] Worktree information displayed in UI
- [x] Worktree cleanup on cell deletion
- [x] Safety checks prevent worktree conflicts
- [x] Database migration works correctly
- [x] End-to-end test: UI → backend → worktree creation

---

## Step 4: Agent Integration

**Branch**: `feat/agent-integration`

### Scope
- **Extend existing cells** with agent functionality
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and state management
- Session lifecycle (create, send, receive, stop)
- Credential validation from OpenCode config
- Agent session management in worktree context
- Cell creation automatically provisions the agent session (with mock fallback) and fails fast if provisioning cannot complete
- **Extend existing UI** from Step 2 with chat interface

### Persistence Added
- `cells` table gains `opencode_session_id`
- Agent transcripts/messages remain inside OpenCode's datastore (Hive rehydrates via stored session ID)

### Tests
- Session creation with mock orchestrator
- Message streaming
- State transitions
- Credential validation
- Fallback to mock when no credentials
- **Integration tests with existing UI from Step 2**

### Dependencies
- Step 2 (needs existing cell management)
- Step 3 (needs worktrees to run agents in)

### Acceptance Criteria
- [/] Can create OpenCode session with SDK via UI
- [/] Messages stream in real-time to UI chat interface
- [/] Mock orchestrator works without credentials
- [/] Session status reflected in UI via runtime + OpenCode session metadata
- [/] Cell creation provisions an agent session automatically (and rolls back on failure)
- [/] Transcripts persist through OpenCode and display in UI
- [/] Model picker surfaces the full `/api/models` catalog (grouped by provider defaults)
- [x] Cell creation form includes the shared model picker to choose the initial agent provider/model
- [/] Agent operates within cell worktree
- [x] [HIVE-2] Use single shared OpenCode server per Hive instance so cells reuse sessions instead of spawning servers
- [x] Cell description auto-sent as first prompt on creation
- [/] End-to-end test: UI → agent session → real responses

---

## Deferred Features (Future Phases)

The following features from the original plan are **deferred** to focus on core value:

### 🔄 Deferred: Prompt Assembly Pipeline
- **Status**: Schema prepared but not implemented
- **Why deferred**: Basic agent sessions work without complex prompt bundling
- **Future**: Will be needed for advanced context management

### 🔄 Deferred: Port Allocation System  
- **Status**: Schema prepared but not implemented
- **Why deferred**: Services not needed for initial agent functionality
- **Future**: Essential when we add service management

### 🔄 Deferred: Service Management & Process Lifecycle
- **Status**: Schema prepared but not implemented  
- **Why deferred**: Complex, not needed for core agent functionality
- **Future**: Will enable development environments within cells

### 🔄 Deferred: Provisioning Orchestration
- **Status**: Logic prepared but not implemented
- **Why deferred**: Complex orchestration not needed for simple worktree + agent
- **Future**: Will coordinate all systems when services are added

---

## Summary Timeline (Rescoped & Reordered)

```
Step 1 (Templates) ✅ COMPLETED
  ↓
Step 2 (Basic Cell Management) ✅ COMPLETED
  ↓
Step 3 (Git Worktree Management)  
  ↓
Step 4 (OpenCode Agent Integration)
```

### Immediate Value Path
This rescoped sequence delivers a **functional agent workspace** in 4 steps:

1. ✅ **Template definitions** (completed)
2. ✅ **Basic cell management** (real database entities)
3. 🔄 **Git worktree integration** (extends existing cells)
4. 🔄 **Agent integration** (extends existing cells)

### Why Basic Cells First?
- **Real entities**: Cells exist in database from day 1
- **Incremental complexity**: Each PR extends existing functionality
- **Testing foundation**: Real database operations enable proper testing
- **User value**: Users can create and manage cells immediately
- **Clear extension path**: Each feature builds on solid foundation

### Deferred Complex Systems
- Prompt assembly pipelines
- Port allocation systems
- Service management
- Complex provisioning orchestration

Each PR is approximately 200-400 LOC and takes 1-3 days to complete including tests and review.

**New estimated timeline: 1-2 weeks** for core functionality completion.

### Future Work
Deferred features will be revisited in Phase 1+ when core functionality is proven and user feedback is collected.
