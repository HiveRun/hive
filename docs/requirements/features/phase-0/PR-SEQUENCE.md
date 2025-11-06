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

## PR #2: Basic Construct Management

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

### Dependencies
- PR #1 (needs templates for construct creation form)

### Acceptance Criteria
- [ ] Can create construct via UI form with real database storage
- [ ] Construct list shows basic info from database
- [ ] Can delete constructs from UI and database
- [ ] Can update construct details (name, description)
- [ ] E2E tests pass for full construct management workflow
- [ ] Database schema ready for worktree extension in PR #3

---

## PR #3: Git Worktree Integration

**Branch**: `feat/git-worktree-integration`

### Scope
- **Extend existing constructs** with git worktree functionality
- Add `workspace_path` to existing constructs
- Create isolated git worktrees for each construct (`.constructs/<id>/`)
- Worktree lifecycle management (create, list, prune, cleanup)
- Worktree isolation and safety checks
- **Extend existing UI** from PR #2 to show worktree information

### Persistence Updates
- **ALTER TABLE constructs ADD COLUMN workspace_path TEXT**
- Update existing constructs to support worktree paths
- Migration script to add workspace_path column

### Tests
- Git worktree creation and cleanup
- Database migration testing
- Worktree isolation verification
- **Integration tests with existing UI from PR #2**

### Dependencies
- PR #1 (needs templates for construct creation)
- PR #2 (needs existing construct management)

### Acceptance Criteria
- [ ] Existing constructs can be extended with worktree functionality
- [ ] Worktree created at `.constructs/<id>/` when requested
- [ ] Worktree information displayed in UI
- [ ] Worktree cleanup on construct deletion
- [ ] Safety checks prevent worktree conflicts
- [ ] Database migration works correctly
- [ ] End-to-end test: UI → backend → worktree creation

---

## PR #4: Agent Integration

**Branch**: `feat/agent-integration`

### Scope
- **Extend existing constructs** with agent functionality
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and state management
- Session lifecycle (create, send, receive, stop)
- Credential validation from OpenCode config
- Agent session management in worktree context
- **Extend existing UI** from PR #2 with chat interface

### Persistence Added
- `agent_sessions` table (id, construct_id, provider, status, started_at, completed_at)
- `agent_messages` table (id, session_id, role, content, timestamp)

### Tests
- Session creation with mock orchestrator
- Message streaming
- State transitions
- Credential validation
- Fallback to mock when no credentials
- **Integration tests with existing UI from PR #2**

### Dependencies
- PR #2 (needs existing construct management)
- PR #3 (needs worktrees to run agents in)

### Acceptance Criteria
- [ ] Can create OpenCode session with SDK via UI
- [ ] Messages stream in real-time to UI chat interface
- [ ] Mock orchestrator works without credentials
- [ ] Session state tracked in database and reflected in UI
- [ ] Transcripts persist to database and display in UI
- [ ] Agent operates within construct worktree
- [ ] End-to-end test: UI → agent session → real responses

---

## Deferred Features (Future Phases)

The following features from the original plan are **deferred** to focus on core value:

### 🔄 PR #2 (Original): Prompt Assembly Pipeline
- **Status**: Schema prepared but not implemented
- **Why deferred**: Basic agent sessions work without complex prompt bundling
- **Future**: Will be needed for advanced context management

### 🔄 PR #4 (Original): Port Allocation System  
- **Status**: Schema prepared but not implemented
- **Why deferred**: Services not needed for initial agent functionality
- **Future**: Essential when we add service management

### 🔄 PR #5 (Original): Service Management & Process Lifecycle
- **Status**: Schema prepared but not implemented  
- **Why deferred**: Complex, not needed for core agent functionality
- **Future**: Will enable development environments within constructs

### 🔄 PR #6 (Original): Provisioning Orchestration
- **Status**: Logic prepared but not implemented
- **Why deferred**: Complex orchestration not needed for simple worktree + agent
- **Future**: Will coordinate all systems when services are added

---

## Summary Timeline (Rescoped & Reordered)

```
PR #1 (Templates) ✅ COMPLETED
  ↓
PR #2 (Basic Construct UI - Mock Backend)
  ↓
PR #3 (Git Worktree Management)  
  ↓
PR #4 (OpenCode Agent Integration)
```

### Immediate Value Path
This rescoped sequence delivers a **functional agent workspace** in 4 PRs:

1. ✅ **Template definitions** (completed)
2. 🔄 **Basic construct management** (real database entities)
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
