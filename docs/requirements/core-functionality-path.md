# Core Functionality Implementation Path

This document outlines the focused implementation path for delivering core Synthetic functionality quickly.

## Target User Experience

**Goal**: A user should be able to:
1. ✅ Define templates in `synthetic.config.ts` (completed)
2. ✅ Create and manage basic constructs through UI (real database)
3. Provision worktrees for existing constructs
4. Start agent sessions in construct worktrees
5. Chat with agents through web interface

**Timeline**: 1-2 weeks for complete, usable functionality

## Rescope Rationale

**New Focus**: Worktrees, OpenCode integration, and base construct capabilities
**Deferred**: Service management, port allocation, complex provisioning orchestration

**Key Insight**: Users can get value from isolated agent workspaces without complex service orchestration. The deferred features remain prepared (schemas, tests) but aren't blocking initial delivery.

## Implementation Sequence

### Step 1: Basic Construct Management (PR #2)

**Branch**: `feat/basic-construct-management`
**Status**: ✅ Completed

#### Core Components
```typescript
// Main UI components to implement
interface ConstructCreationForm {
  name: string
  description: string
  templateId: string
}

interface ConstructList {
  constructs: Construct[]
  onCreateConstruct: () => void
  onSelectConstruct: (id: string) => void
}

// Real backend implementation
interface ConstructService {
  createConstruct(data: CreateConstructData): Promise<Construct>
  listConstructs(): Promise<Construct[]>
  deleteConstruct(id: string): Promise<void>
  updateConstructStatus(id: string, status: ConstructStatus): Promise<void>
}
```

#### Database Schema
```sql
CREATE TABLE constructs (
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
- Construct creation form with template selection from PR #1
- Construct list showing basic info
- **Real database persistence** for construct entities
- **No status tracking, no worktree, no agents** - just basic construct management
- Component-level tests with real data
- E2E tests for complete construct management workflow

#### Acceptance Tests
- Can create construct via UI form with real database storage
- Construct list shows correct info from database
- Can delete constructs from UI and database
- Can update construct details (name, description)
- E2E test for complete construct management workflow
- Database schema ready for extension in PR #3

---

### Step 2: Git Worktree Integration (PR #3)

**Branch**: `feat/git-worktree-integration`

#### Core Functionality
```typescript
// Extend existing construct service
interface WorktreeManager {
  createWorktree(constructId: string): Promise<string> // returns worktree path
  listWorktrees(): Promise<WorktreeInfo[]>
  pruneWorktree(constructId: string): Promise<void>
  cleanupWorktree(constructId: string): Promise<void>
}

interface ConstructService {
  // Existing methods from PR #2...
  provisionWorktree(constructId: string): Promise<void> // new method
}

// Status tracking not needed until PR #4
```

#### Database Schema Updates
```sql
-- Migration to add worktree support
ALTER TABLE constructs ADD COLUMN workspace_path TEXT;
```

#### Key Implementation Details
- **Extend existing constructs** with worktree functionality
- Use `git worktree add .constructs/<id>` to create isolated workspaces
- Track worktree lifecycle to prevent orphaned worktrees
- Implement safety checks (no duplicate worktrees, proper cleanup)
- **Extend existing UI** to show worktree information and controls

#### Acceptance Tests
- Can create worktree for existing construct
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
// Extend existing construct system
interface AgentManager {
  createSession(constructId: string, template: Template): Promise<AgentSession>
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
  constructId: string
  sessionId: string
  messages: AgentMessage[]
  onSendMessage: (message: string) => void
  onStopSession: () => void
}
```

#### Database Schema
```sql
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  construct_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'opencode',
  status TEXT NOT NULL DEFAULT 'starting',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (construct_id) REFERENCES constructs(id)
);

CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);
```

#### Key Implementation Details
- **Extend existing constructs** with agent functionality
- Integrate `@opencode-ai/sdk` for real OpenCode sessions
- Implement mock orchestrator for development without credentials
- Set working directory to construct's worktree (from PR #3)
- Stream messages in real-time to UI
- Handle session lifecycle (starting → running → completed/error)
- **Extend existing UI** with chat interface

#### Acceptance Tests
- Can create session with real OpenCode credentials
- Mock orchestrator works without credentials
- Messages stream correctly to UI
- Session operates within construct worktree
- Transcripts persist to database
- **Integration tests with existing UI from Step 1**

---

## Integration Points

### Template System Integration
- Templates provide initial context for agent sessions
- Template selection in construct creation form
- Template validation before construct creation

### Worktree-Agent Integration
- Agent sessions run within construct worktree
- Working directory set to `.constructs/<id>/`
- File operations affect isolated worktree only

### UI-Backend Integration
- Real-time updates for construct status
- Streaming agent messages to chat interface
- Session lifecycle controls in UI

## Success Criteria

### Minimum Viable Product
1. ✅ User can define templates in config
2. 🔄 User can create and manage basic constructs through UI (real database)
3. 🔄 User can provision worktrees for existing constructs
4. 🔄 User can start agent sessions in construct worktrees
5. 🔄 User can chat with agents through web interface

### Success Metrics
- Time from template definition to working construct management: < 2 days
- Time from basic constructs to worktree integration: < 3 days
- Time from worktree to agent integration: < 4 days
- End-to-end workflow completion: < 2 minutes
- Zero configuration beyond `synthetic.config.ts`

### Testing Strategy
- **Step 1**: Real database operations from day 1
- **Step 2**: Worktree functionality tested against existing constructs
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
├── constructs/        # Construct CRUD operations
└── routes/           # API endpoints

web/src/
├── components/
│   ├── construct/     # Construct creation/listing
│   ├── chat/         # Agent chat interface
│   └── templates/    # Template browser (existing)
└── routes/           # Frontend routes
```

### API Endpoints
```typescript
// Core endpoints to implement
POST /api/constructs              # Create construct
GET /api/constructs               # List constructs
DELETE /api/constructs/:id        # Delete construct

POST /api/agents/sessions         # Create agent session
POST /api/agents/sessions/:id/messages  # Send message
GET /api/agents/sessions/:id/messages/stream   # Stream messages
DELETE /api/agents/sessions/:id    # Stop session
```

This focused path delivers a complete, usable agent workspace system quickly while preserving all the advanced capabilities for future implementation.