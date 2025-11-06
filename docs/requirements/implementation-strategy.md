# Implementation Strategy (Rescoped)

## Phase 0: Core Infrastructure (Rescoped for Fast Value)

### Development Strategy
**Approach**: Sequential PRs focused on delivering immediate value

**Rationale**: To get Synthetic useful quickly, we're focusing on the core path: **worktrees + OpenCode integration + basic constructs**. Complex service management and provisioning are deferred.

### Rescope Decision
**New Focus**: Worktrees, OpenCode integration, and base construct capabilities
**Deferred**: Service management, port allocation, complex provisioning orchestration

**Key Insight**: Users can get value from isolated agent workspaces without complex service orchestration. The deferred features remain prepared (schemas, tests) but aren't blocking initial delivery.

### PR Sequence (Rescoped)

#### PR #1: Template Definition System ✅ **COMPLETED**
- TypeScript config schema (`synthetic.config.ts`)
- Template validation and type safety
- Basic template browser/listing in UI
- **Persistence**: File-based storage in `synthetic.config.ts` (intentional)
- Tests with in-memory fixtures

#### PR #2: Git Worktree Management
- Create isolated git worktrees for each construct (`.constructs/<id>/`)
- Worktree lifecycle management (create, list, prune, cleanup)
- Basic construct CRUD operations and status tracking
- **Persistence**: `constructs` table with metadata
- Tests for worktree creation and isolation

#### PR #3: OpenCode Agent Integration  
- `@opencode-ai/sdk` integration
- Mock orchestrator fallback for development
- Message streaming and session management
- **Persistence**: `agent_sessions` and `agent_messages` tables
- Tests using mock orchestrator

#### PR #4: Basic Construct UI & Orchestration
- Construct creation form and listing UI
- Basic chat interface (transcript, composer)
- Keyboard shortcuts and lifecycle visualization
- **Persistence**: Minimal UI state
- E2E tests for complete workflow

### Deferred Features (Prepared but Not Implemented)

The following features have complete schemas and test plans but are deferred to accelerate delivery:

#### PR #2 (Original): Prompt Assembly Pipeline
- **Status**: Schema prepared, implementation deferred
- **Why**: Basic agent sessions work without complex prompt bundling
- **Future**: Will be essential for advanced context management

#### PR #4 (Original): Port Allocation System
- **Status**: Schema prepared, implementation deferred  
- **Why**: Services not needed for initial agent functionality
- **Future**: Essential when we add service management

#### PR #5 (Original): Service Management & Process Lifecycle
- **Status**: Schema prepared, implementation deferred
- **Why**: Complex, not needed for core agent functionality
- **Future**: Will enable development environments within constructs

#### PR #6 (Original): Provisioning Orchestration
- **Status**: Logic prepared, implementation deferred
- **Why**: Complex orchestration not needed for simple worktree + agent
- **Future**: Will coordinate all systems when services are added

### Benefits of Rescoped Approach
1. **Faster Time to Value** - Core functionality delivered in 4 PRs vs 8
2. **Reduced Complexity** - Focus on essential path first
3. **User Feedback Sooner** - Real usage can guide deferred feature implementation
4. **Lower Risk** - Fewer moving parts in initial release
5. **Preserved Investment** - All schemas and test designs remain available
6. **Clear Migration Path** - Deferred features have clear integration points

## Phase 1: Enhanced Runtime (Post-Rescope)

### Development Strategy
**Approach**: Implement deferred features + new capabilities

**Rationale**: After core functionality is proven, we can add the complex systems that were deferred from Phase 0.

### Phase 1A: Complete the Original Vision
Implement the deferred Phase 0 features:

#### PR #1A: Prompt Assembly Pipeline
- Implement the prepared prompt bundling system
- Variable substitution and context injection
- Token estimation and bundle generation

#### PR #2A: Service Management & Process Lifecycle  
- Implement the prepared service management system
- Process spawning, environment injection, ready patterns
- Port allocation integration

#### PR #3A: Advanced Provisioning Orchestration
- Complete the prepared provisioning system
- Wire together all systems with rollback capabilities

### Phase 1B: New Runtime Features
Add capabilities that build on the now-complete foundation:

#### PR #4B: Diff Review & Code Visualization
- Visual diff displays for agent changes
- Code review interface within constructs
- Change approval/rejection workflows

#### PR #5B: Docker Compose Support
- Docker service definitions in templates
- Container lifecycle management
- Volume and networking configuration

#### PR #6C: Service Control Interface
- Start/stop/restart service controls
- Service logs and monitoring
- Health check visualization

#### PR #7D: Workspace Switching
- Multiple workspace management
- Quick context switching between constructs
- Workspace-scoped templates and settings

### Branch Workflow
```bash
# Phase 1A - Complete original vision
git checkout -b feature/prompt-assembly-pipeline
git checkout -b feature/service-management  
git checkout -b feature/provisioning-orchestration

# Phase 1B - Add new capabilities (can be parallel)
git checkout -b feature/diff-review
git checkout -b feature/docker-support
git checkout -b feature/service-control
git checkout -b feature/workspace-switching
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