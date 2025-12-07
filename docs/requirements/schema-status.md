# Schema and Implementation Status

This document tracks the current status of prepared schemas, validation, and tests following the Phase 0 rescope decision.

## Overview

**Rescope Decision**: Focus on worktrees, OpenCode integration, and base cell capabilities to deliver value quickly.

**Result**: Many schemas and test plans were prepared but are not currently implemented. They remain available for future implementation.

### Migration Reset — 2025-11-28
- Removed all historical Drizzle migrations tied to "construct" naming and regenerated a single baseline that creates `cells` and `cell_services`
- Developers must delete their local SQLite files (e.g., `apps/server/local.db`) and rerun `bun run --cwd apps/server db:push` after pulling this change
- Deferred tables from earlier specs now live only in documentation until they are reintroduced through new migrations

## Current Implementation Status

### ✅ Implemented and Active

#### Template Definition System
- **File**: `hive.config.json` schema
- **Status**: ✅ Active, file-based storage
- **Usage**: Template definitions and validation
- **Tests**: ✅ Implemented and passing

### 🔄 Currently Implementing

#### Basic Cell Management
- **Schema**: `cells` table
- **Status**: ✅ Completed (Step 2)
- **Usage**: Basic cell CRUD operations
- **Tests**: ✅ Implemented and passing

#### Git Worktree Management
- **Schema**: `cells` table (extended)
- **Status**: 🔄 Next up (Step 3)
- **Usage**: Worktree lifecycle and cell tracking
- **Tests**: 🔄 Planned

#### OpenCode Agent Integration
- **Schema Update**: `cells.opencode_session_id` column (maps cells → OpenCode session)
- **Status**: ✅ Completed (Step 4)
- **Usage**: Backend rehydrates agent runtime by looking up the stored OpenCode session ID; transcripts live inside OpenCode's datastore
- **Tests**: 🔄 Remote-session recovery tests planned

## 📦 Prepared But Not Currently Implemented

### Prompt Assembly Pipeline (Deferred)
- **Schema**: `prompt_bundles` table
- **Validation**: Prompt source resolution, variable substitution
- **Tests**: Glob patterns, token estimation, bundle generation
- **Status**: 🔄 Deferred to Phase 1A
- **Reason**: Basic agent sessions work without complex prompt bundling

### Port Allocation System (Deferred)
- **Schema**: `port_allocations` table
- **Validation**: Port probing, allocation strategy
- **Tests**: Conflict resolution, reservation tracking
- **Status**: 🔄 Deferred to Phase 1A
- **Reason**: Services not needed for initial agent functionality

### Service Management (Deferred)
- **Schema**: `services` table with runtime state
- **Validation**: Service parsing, process lifecycle
- **Tests**: Process spawning, ready patterns, graceful shutdown
- **Status**: 🔄 Deferred to Phase 1A
- **Reason**: Complex, not needed for core agent functionality

### Advanced Provisioning (Deferred)
- **Schema**: Updates to `cells` status tracking
- **Validation**: Multi-step orchestration, rollback logic
- **Tests**: Integration tests, failure scenarios
- **Status**: 🔄 Deferred to Phase 1A
- **Reason**: Complex orchestration not needed for simple worktree + agent

## Database Schema Status

### Active Tables
```sql
cells (
  id,
  name,
  description,
  template_id,
  workspace_id,
  workspace_root_path,
  workspace_path,
  opencode_session_id,
  opencode_server_url,
  opencode_server_port,
  status,
  last_setup_error,
  branch_name,
  base_commit,
  created_at
)

cell_services (
  id,
  cell_id,
  name,
  type,
  command,
  cwd,
  env,
  status,
  port,
  pid,
  ready_timeout_ms,
  definition,
  last_known_error,
  created_at,
  updated_at
)
```

### Prepared Tables (Concept Only)
The prompt bundle, port allocation, and advanced service tables described later in this document do **not** exist in the regenerated migration baseline. When we resume those features we will add brand-new migrations instead of editing the baseline.

## Test Status

### Active Tests
- ✅ Template schema validation
- ✅ Template loading from config files
- ✅ UI rendering of template list
- ✅ E2E tests for templates page
- 🔄 Worktree management (in progress)

### Prepared Tests (Not Currently Used)
- 🔄 Prompt assembly pipeline tests
- 🔄 Port allocation system tests
- 🔄 Service management tests
- 🔄 Advanced provisioning tests
- 🔄 Agent integration tests

## Migration Path

All prepared schemas and tests are designed with clear integration points:

1. **Phase 1A**: Implement deferred features in original order
2. **Phase 1B**: Add new runtime capabilities
3. **Future phases**: Build on complete foundation

## Benefits of This Approach

1. **Accelerated Delivery**: Core functionality in 4 PRs vs 8
2. **Preserved Investment**: All design work remains available
3. **Reduced Risk**: Fewer moving parts in initial release
4. **User Feedback**: Real usage can guide implementation priorities
5. **Clear Architecture**: Integration points are well-defined

## Notes for Future Implementation

- All schemas follow consistent naming conventions
- Test plans include edge cases and error scenarios
- Integration points are documented in each feature spec
- Database migrations are prepared for smooth rollout