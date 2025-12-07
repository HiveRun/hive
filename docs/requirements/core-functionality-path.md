# Core Functionality Implementation Path

This document outlines the focused implementation path for delivering core Hive functionality quickly.

## Target User Experience

**Goal**: A user should be able to:
1. ✅ Define templates in `hive.config.jsonc` (or `hive.config.json`) (completed)
2. ✅ Create and manage basic cells through UI (real database)
3. Provision worktrees for existing cells
4. Start agent sessions in cell worktrees
5. Chat with agents through web interface

**Timeline**: 1-2 weeks for complete, usable functionality

## Rescope Rationale

**New Focus**: Worktrees, OpenCode integration, and base cell capabilities
**Deferred**: Service management, port allocation, complex provisioning orchestration

**Key Insight**: Users can get value from isolated agent workspaces without complex service orchestration. The deferred features remain prepared (schemas, tests) but aren't blocking initial delivery.

## Implementation Sequence

### Step 1: Basic Cell Management (Step 2)

**Branch**: `feat/basic-cell-management`
**Status**: ✅ Completed

#### Core Components
```typescript
// Main UI components to implement
interface CellCreationForm {
  name: string
  description: string
  templateId: string
}

interface CellList {
  cells: Cell[]
  onCreateCell: () => void
  onSelectCell: (id: string) => void
}

// Real backend implementation
interface CellService {
  createCell(data: CreateCellData): Promise<Cell>
  listCells(): Promise<Cell[]>
  deleteCell(id: string): Promise<void>
  updateCellStatus(id: string, status: CellStatus): Promise<void>
}
```

#### Database Schema
```sql
CREATE TABLE cells (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  template_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  -- workspace_path added in PR #3
  -- status tracking not needed yet
);
```

#### Key Implementation Details
- Cell creation form with template selection from PR #1
- Cell list showing basic info
- **Real database persistence** for cell entities
- **No status tracking, no worktree, no agents** - just basic cell management
- Component-level tests with real data
- E2E tests for complete cell management workflow

#### Acceptance Tests
- Can create cell via UI form with real database storage
- Cell list shows correct info from database
- Can delete cells from UI and database
- Can update cell details (name, description)
- E2E test for complete cell management workflow
- Database schema ready for extension in PR #3

---

### Step 2: Git Worktree Integration (PR #3)

**Branch**: `feat/git-worktree-integration`

#### Core Functionality
```typescript
// Extend existing cell service
interface WorktreeManager {
  createWorktree(
    cellId: string
  ): Effect.Effect<WorktreeLocation, WorktreeManagerError> // Effect-first API with structured errors
  listWorktrees(): Promise<WorktreeInfo[]>
  pruneWorktree(cellId: string): Promise<void>
  cleanupWorktree(cellId: string): Promise<void>
}

interface CellService {
  // Existing methods from PR #2...
  provisionWorktree(cellId: string): Promise<void> // new method
}

// Status tracking not needed until PR #4
```

> **Implementation update (2025-12-04)**: The production `WorktreeManager` now returns `Effect` values. Git/filesystem failures surface as `WorktreeManagerError` so routes can handle them via `Effect.match` / `runServerEffect` without Result helpers.

#### Database Schema Updates
```sql
-- Migration to add worktree support
ALTER TABLE cells ADD COLUMN workspace_path TEXT;
```

#### Key Implementation Details
- **Extend existing cells** with worktree functionality
- Use `git worktree add .cells/<id>` to create isolated workspaces
- Track worktree lifecycle to prevent orphaned worktrees
- Implement safety checks (no duplicate worktrees, proper cleanup)
- **Extend existing UI** to show worktree information and controls

#### Acceptance Tests
- Can create worktree for existing cell
- Worktree is isolated (changes don't affect main repo)
- Can list and delete worktrees
- Worktree information displayed in UI
- Cleanup removes all traces
- Database migration works correctly
- **Integration tests with existing UI from Step 1**

---

### Step 3: Agent Integration (PR #4)

**Branch**: `feat/agent-integration`

#### Core Functionality
```typescript
// Extend existing cell system
interface AgentManager {
  createSession(cellId: string, template: Template): Promise<AgentSession>
  sendMessage(sessionId: string, message: string): Promise<void>
  streamMessages(sessionId: string): AsyncIterable<AgentMessage>
  stopSession(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): Promise<SessionStatus>
}

interface OpenCodeConfig {
  validateCredentials(): Promise<boolean>
  getWorkspaceId(): string | null
  getAuthToken(): string | null
}

// Extend existing UI
interface ChatInterface {
  cellId: string
  sessionId: string
  messages: AgentMessage[]
  onSendMessage: (message: string) => void
  onStopSession: () => void
}
```

#### Database Schema
```sql
ALTER TABLE cells
  ADD COLUMN opencode_session_id TEXT NULL;
```

> Agent transcripts and message history live inside OpenCode's own datastore. Hive keeps only the `opencode_session_id` pointer so it can rehydrate sessions on demand.

#### Key Implementation Details
- **Extend existing cells** with agent functionality
- Integrate `@opencode-ai/sdk` for real OpenCode sessions
- Implement mock orchestrator for development without credentials
- Set working directory to cell's worktree (from PR #3)
- Stream messages in real-time to UI using the same `message.updated` / `message.part.updated` / `permission.updated` events that OpenCode’s TUI exposes
- Handle session lifecycle (starting → running → completed/error)
- Cell creation automatically provisions the agent session (mock vs provider based on form input) and rolls back the worktree/DB row if provisioning fails
- Surface permission prompts directly in the chat so agents can request file/network access without falling back to the CLI
- **Extend existing UI** with chat interface

#### Acceptance Tests
- Can create session with real OpenCode credentials
- Mock orchestrator works without credentials
- Messages stream correctly to UI
- Session operates within cell worktree
- Cell creation fails with actionable error if agent provisioning fails (e.g., missing credentials) and leaves no orphaned worktree
- Permission prompts can be approved/denied from the chat UI (no fallback to CLI banners)
- Transcripts persist via OpenCode's datastore (Hive can rehydrate by session ID)
- **Integration tests with existing UI from Step 1**

---

## Integration Points

### Template System Integration
- Templates provide initial context for agent sessions
- Template selection in cell creation form
- Template validation before cell creation

### Worktree-Agent Integration
- Agent sessions run within cell worktree
- Working directory set to `.cells/<id>/`
- File operations affect isolated worktree only

### UI-Backend Integration
- Real-time updates for cell status
- Streaming agent messages to chat interface
- Session lifecycle controls in UI

## Success Criteria

### Minimum Viable Product
1. ✅ User can define templates in config
2. 🔄 User can create and manage basic cells through UI (real database)
3. 🔄 User can provision worktrees for existing cells
4. 🔄 User can start agent sessions in cell worktrees
5. 🔄 User can chat with agents through web interface

### Success Metrics
- Time from template definition to working cell management: < 2 days
- Time from basic cells to worktree integration: < 3 days
- Time from worktree to agent integration: < 4 days
- End-to-end workflow completion: < 2 minutes
- Zero configuration beyond `hive.config.jsonc` / `hive.config.json`

### Testing Strategy
- **Step 1**: Real database operations from day 1
- **Step 2**: Worktree functionality tested against existing cells
- **Step 3**: Agent integration tested against complete system
- **Each step**: Extends and validates previous functionality

## Future Enhancement Path

Once core functionality is working, we can add:
1. **Prompt Assembly**: Better context management
2. **Service Management**: Development environments
3. **Advanced UI**: Better visualization and controls
4. **Collaboration**: Multi-user features

## Development Notes

### File Structure
```
apps/server/src/
├── worktree/          # Worktree management
├── agents/            # OpenCode integration
├── cells/        # Cell CRUD operations
└── routes/           # API endpoints

web/src/
├── components/
│   ├── cell/     # Cell creation/listing
│   ├── chat/         # Agent chat interface
│   └── templates/    # Template browser (existing)
└── routes/           # Frontend routes
```

### API Endpoints
```typescript
// Core endpoints to implement
POST /api/cells              # Create cell
GET /api/cells               # List cells
DELETE /api/cells/:id        # Delete cell

POST /api/agents/sessions         # Create agent session
POST /api/agents/sessions/:id/messages  # Send message
GET /api/agents/sessions/:id/messages/stream   # Stream messages
DELETE /api/agents/sessions/:id    # Stop session
```

This focused path delivers a complete, usable agent workspace system quickly while preserving all the advanced capabilities for future implementation.