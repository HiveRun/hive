# Phase 0 PR Sequence (Rescoped)

This document outlines the sequential PR strategy for Phase 0 implementation, **rescoped to focus on core functionality that delivers value quickly**.

## Strategy Overview

**Approach**: Each PR is focused, reviewable (200-400 LOC), and includes only the persistence layer it needs.

**Key Principle**: Persistence grows organically—we don't build the full schema upfront. Each PR adds tables/queries as needed.

## Rescope Decision

**New Focus**: Worktrees, OpenCode integration, and base construct capabilities
**Deferred**: Service management, port allocation, complex provisioning orchestration

**Rationale**: To get Synthetic useful quickly, we need:
1. ✅ Template definitions (completed)
2. 🔄 Git worktree management for isolated workspaces  
3. 🔄 OpenCode SDK integration for agent sessions
4. 🔄 Basic construct lifecycle (create, list, status)

**Note**: All schemas, validation, and tests from the original plan remain in place but are marked as **PREPARED BUT NOT CURRENTLY USED** to enable faster implementation of the core path.

---

## Step 1: Template Definition System ✅ **COMPLETED**

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

## Step 2: Basic Construct Management ✅ **COMPLETED**

**Branch**: `feat/basic-construct-management`

### Scope
- Construct creation form UI (name, description, template selection)
- Construct listing page
- **Real database persistence** for basic constructs
- Construct CRUD operations (create, list, delete, update)
- **No status tracking, no worktree, no services, no agents** - just basic construct entities

### Persistence Added
- `constructs` table (id, name, description, template_id, created_at, updated_at)
- **Note**: workspace_path and status added later in PR #3
- Queries: create, list, get by id, delete, update

### Tests
- Construct creation form validation
- Database CRUD operations
- UI component tests with real data
- E2E tests for complete construct management workflow
- [x] Playwright snapshots mock API responses with deterministic Faker fixtures

### Dependencies
- Step 1 (needs templates for construct creation form)

### Acceptance Criteria
- [x] Can create construct via UI form with real database storage
- [x] Construct list shows basic info from database
- [x] Can delete constructs from UI and database
- [x] Can bulk delete constructs from UI and database
- [x] Can update construct details (name, description)
- [x] E2E tests pass for full construct management workflow
- [x] Database schema ready for worktree extension in PR #3

---

## Step 3: Git Worktree Integration ✅ **COMPLETED**

**Branch**: `feat/git-worktree-integration`

### Scope
- **Extend existing constructs** with git worktree functionality
- Add `workspace_path` to existing constructs
- Create isolated git worktrees for each construct (`.constructs/<id>/`)
- Worktree lifecycle management (create, list, prune, cleanup)
- Worktree isolation and safety checks
- **Extend existing UI** from Step 2 to show worktree information

### Persistence Updates
- **ALTER TABLE constructs ADD COLUMN workspace_path TEXT**
- Update existing constructs to support worktree paths
- Migration script to add workspace_path column

### Tests
- Git worktree creation and cleanup
- Database migration testing
- Worktree isolation verification
- **Integration tests with existing UI from Step 2**

### Dependencies
- Step 1 (needs templates for construct creation)
- Step 2 (needs existing construct management)

### Acceptance Criteria
- [x] Existing constructs can be extended with worktree functionality
- [x] Worktree created at `.constructs/<id>/` when requested
- [x] Worktree information displayed in UI
- [x] Worktree cleanup on construct deletion
- [x] Safety checks prevent worktree conflicts
- [x] Database migration works correctly
- [x] End-to-end test: UI → backend → worktree creation

---

## Step 4: Agent Integration

**Branch**: `feat/agent-integration`

### Scope
- **Extend existing constructs** with agent functionality
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and state management
- Session lifecycle (create, send, receive, stop)
- Credential validation from OpenCode config
- Agent session management in worktree context
- Construct creation automatically provisions the agent session (with mock fallback) and fails fast if provisioning cannot complete
- **Extend existing UI** from Step 2 with chat interface

### Persistence Added
- `constructs` table gains `opencode_session_id`
- Agent transcripts/messages remain inside OpenCode's datastore (Synthetic rehydrates via stored session ID)

### Tests
- Session creation with mock orchestrator
- Message streaming
- State transitions
- Credential validation
- Fallback to mock when no credentials
- **Integration tests with existing UI from Step 2**

### Dependencies
- Step 2 (needs existing construct management)
- Step 3 (needs worktrees to run agents in)

### Acceptance Criteria
- [/] Can create OpenCode session with SDK via UI
- [/] Messages stream in real-time to UI chat interface
- [/] Mock orchestrator works without credentials
- [/] Session status reflected in UI via runtime + OpenCode session metadata
- [/] Construct creation provisions an agent session automatically (and rolls back on failure)
- [/] Transcripts persist through OpenCode and display in UI
- [/] Agent operates within construct worktree
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
- **Future**: Will enable development environments within constructs

### 🔄 Deferred: Provisioning Orchestration
- **Status**: Logic prepared but not implemented
- **Why deferred**: Complex orchestration not needed for simple worktree + agent
- **Future**: Will coordinate all systems when services are added

---

## Summary Timeline (Rescoped & Reordered)

```
Step 1 (Templates) ✅ COMPLETED
  ↓
Step 2 (Basic Construct Management) ✅ COMPLETED
  ↓
Step 3 (Git Worktree Management)  
  ↓
Step 4 (OpenCode Agent Integration)
```

### Immediate Value Path
This rescoped sequence delivers a **functional agent workspace** in 4 steps:

1. ✅ **Template definitions** (completed)
2. ✅ **Basic construct management** (real database entities)
3. 🔄 **Git worktree integration** (extends existing constructs)
4. 🔄 **Agent integration** (extends existing constructs)

### Why Basic Constructs First?
- **Real entities**: Constructs exist in database from day 1
- **Incremental complexity**: Each PR extends existing functionality
- **Testing foundation**: Real database operations enable proper testing
- **User value**: Users can create and manage constructs immediately
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
