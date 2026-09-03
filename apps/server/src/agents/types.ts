/**
 * Application-layer types for agent sessions and messages.
 *
 * These types adapt OpenCode runtime data with Hive-specific concerns:
 * - Track which cell owns a session (cellId, templateId)
 * - Add custom status tracking beyond OpenCode's session lifecycle
 * - Serialize runtime types into simplified API responses
 *
 * Note: These are Hive's public domain types, not generated client types.
 */

/**
 * Custom session statuses that track Hive-specific workflow states.
 * These are distinct from OpenCode's internal session states.
 */
const agentSessionStatuses = [
  "starting",
  "working",
  "awaiting_input",
  "completed",
  "error",
] as const;

export type AgentSessionStatus = (typeof agentSessionStatuses)[number];

const agentModes = ["plan", "build"] as const;
export type AgentMode = (typeof agentModes)[number];

/**
 * Message roles - subset of what OpenCode supports, focused on our use cases.
 */
export type AgentMessageRole = "user" | "assistant" | "system";

export type AgentMessagePart = {
  type: string;
  [key: string]: unknown;
};

/**
 * Message states - our interpretation of OpenCode message lifecycle.
 */
export type AgentMessageState = "pending" | "streaming" | "completed" | "error";

/**
 * Application model for agent sessions.
 *
 * Adapts OpenCode session data with:
 * - cellId: Links session to a Hive cell
 * - templateId: Tracks which template config was used
 * - provider: AI provider (anthropic, openai, etc.)
 * - status: Custom workflow status tracking
 */
export type AgentSessionRecord = {
  id: string;
  cellId: string;
  templateId: string;
  provider?: string;
  status: AgentSessionStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  modelId?: string;
  modelProviderId?: string;
  modelVariant?: string;
  startMode?: AgentMode;
  currentMode?: AgentMode;
  modeUpdatedAt?: string;
};

/**
 * Serialized/normalized messages for API responses.
 *
 * Simplifies OpenCode message data by:
 * - Extracting text content from parts for convenience
 * - Adding state interpretation (pending, streaming, completed, error)
 * - Keeping parts array for detailed access when needed
 */
export type AgentMessageRecord = {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string | null;
  state: AgentMessageState;
  createdAt: string;
  parts: AgentMessagePart[];
  parentId?: string | null;
  errorName?: string | null;
  errorMessage?: string | null;
};

type AgentCompactionStats = {
  count: number;
  lastCompactionAt: string | null;
};

/**
 * Stream events sent over SSE to clients.
 * Combines Hive events with the stable event shapes adapted from OpenCode.
 */
export type AgentRuntimeEvent =
  | {
      type: "message.updated";
      properties: {
        info: {
          id: string;
          sessionID: string;
          role: "user" | "assistant";
          time: { created: number; completed?: number };
          mode?: string;
          model?: { providerID: string; modelID: string; variant?: string };
          error?: unknown;
        };
      };
    }
  | {
      type: "permission.asked" | "permission.updated";
      properties: {
        id: string;
        sessionID: string;
        permission: string;
        patterns: string[];
        metadata: Record<string, unknown>;
        always: string[];
      };
    }
  | {
      type: "permission.replied";
      properties: {
        sessionID: string;
        permissionID: string;
        response: "once" | "always" | "reject";
      };
    }
  | {
      type: "question.asked";
      properties: {
        id: string;
        sessionID: string;
        questions: Array<{ question: string }>;
      };
    }
  | {
      type: "question.replied";
      properties: {
        id: string;
        sessionID: string;
        answer: unknown;
      };
    }
  | {
      type: "question.rejected";
      properties: { id: string; sessionID: string };
    }
  | {
      type: "session.status";
      properties: {
        sessionID: string;
        status: { type: "idle" | "busy" | "retry" };
      };
    }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.error";
      properties: { sessionID: string; error: unknown };
    }
  | {
      type: "session.compacted";
      properties: { sessionID: string; compacted?: number; count?: number };
    };

export type AgentStreamEvent =
  | { type: "history"; messages: AgentMessageRecord[] }
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | {
      type: "mode";
      startMode: AgentMode;
      currentMode: AgentMode;
      modeUpdatedAt?: string;
    }
  | { type: "session.compaction"; properties: AgentCompactionStats }
  | AgentRuntimeEvent;
