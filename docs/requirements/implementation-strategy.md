# Implementation Strategy

## Phase 0: Core Infrastructure

### Development Strategy
**Approach**: Sequential PRs with incremental complexity

**Rationale**: Features have clear dependencies and benefit from focused review cycles. Each PR includes only the persistence layer it needs, growing the schema organically.

### PR Sequence

#### PR #1: Template Definition System
- TypeScript config schema (`synthetic.config.ts`)
- Template validation and type safety
- Basic template browser/listing in UI
- **Persistence**: `templates` table and basic CRUD operations
- Tests with in-memory fixtures

#### PR #2: Prompt Assembly Pipeline
- Prompt source resolution (files, globs, ordering)
- Variable substitution and context injection
- Bundle generation and token estimation
- **Persistence**: `prompt_bundles` table to store assembled prompts
- Tests with mock templates from PR #1

#### PR #3: Workspace & Construct Lifecycle
- Create `.constructs/<id>` directories
- Construct CRUD operations (create, list, delete)
- Basic construct status (draft, provisioning, ready, error)
- **Persistence**: `constructs` table with metadata (name, description, template_id, workspace_path, status)
- UI for construct creation form and listing
- Tests for directory creation and cleanup

#### PR #4: Port Allocation System
- OS-level port probing (avoid collisions)
- Port allocation strategy (preferred → fallback)
- Port reservation tracking
- **Persistence**: `port_allocations` table linking ports to constructs/services
- Utility functions for claiming/releasing ports
- Tests with mock port probing

#### PR #5: Service Management & Process Lifecycle
- Parse service definitions from templates
- Spawn child processes with `child_process.spawn`
- Environment variable injection (including allocated ports)
- Ready pattern detection (stdout/stderr scanning)
- Graceful shutdown and cleanup
- **Persistence**: `services` table with runtime state (pid, command, cwd, env, status, ready_pattern)
- Service status transitions (starting → ready → stopped → error)
- Tests with mock processes and real simple commands

#### PR #6: Provisioning Orchestration
- Wire together workspace + ports + services + prompts
- Multi-step provisioning flow with rollback on failure
- Provision API endpoint that coordinates everything
- **Persistence**: Update construct status through provisioning stages
- Error handling and cleanup on failed provisioning
- Integration tests for full provisioning flow

#### PR #7: OpenCode Agent Integration
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and state management
- **Persistence**: `agent_sessions` and `agent_messages` tables
- Tests using mock orchestrator

#### PR #8: Agent Orchestration Engine (UI + Glue)
- Chat interface components (transcript, composer)
- Keyboard shortcuts (Cmd+Enter to send)
- Status updates and lifecycle visualization
- Wiring together constructs + agents + UI
- **Persistence**: Any missing UI state (drafts, scroll positions if needed)
- E2E tests for complete flows

### Benefits of This Approach
1. **Faster Review Cycles** - Each PR is 200-400 LOC, easier to review thoroughly
2. **Easier Debugging** - Smaller surface area when issues arise
3. **Progressive Testing** - Each layer validated before building on top
4. **Organic Schema Growth** - Persistence grows with actual needs, not speculation
5. **Reduced Merge Conflicts** - Less time between branch creation and merge
6. **Clear Separation** - Agent SDK integration (PR #7) separate from UI orchestration (PR #8)

## Phase 1: Core Runtime

### Development Strategy
**Approach**: Parallel feature branches with integration branch

**Rationale**: Features have moderate dependencies but can be developed independently.

### Branch Workflow
```bash
# Create feature branches
git checkout -b feature/diff-review
git checkout -b feature/docker-support
git checkout -b feature/service-control
git checkout -b feature/workspace-switching

# Develop in parallel, then integrate
git checkout -b integrate/phase-1-runtime
git merge feature/diff-review
git merge feature/docker-support
git merge feature/service-control
git merge feature/workspace-switching
```

## Phase 2: Advanced Interaction

### Development Strategy
**Approach**: Independent feature branches per feature

**Rationale**: Features are mostly independent with light dependencies.

### Branch Workflow
```bash
# Each feature in its own branch
git checkout -b feature/voice-input
git checkout -b feature/sparse-constructs
# ... etc

# Individual PRs to main
```

## Phase 3: Planning & Collaboration

### Development Strategy
**Approach**: Feature groups with shared planning infrastructure

**Rationale**: Some features share planning-related dependencies.

### Branch Workflow
```bash
# Planning infrastructure first
git checkout -b feature/planning-handoff

# Then dependent features
git checkout -b feature/reference-repos
git checkout -b feature/config-editor
# ... etc
```

## Phase 4: Analytics & Terminal

### Development Strategy
**Approach**: Independent features, data-dependent

**Rationale**: Features depend on data from earlier phases but are independent of each other.

### Branch Workflow
```bash
# Can be developed in parallel
git checkout -b feature/insight-analytics
git checkout -b feature/activity-timeline
git checkout -b feature/terminal-ui
```