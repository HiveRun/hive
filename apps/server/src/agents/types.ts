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
  errorMessage?: string | null;
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
  errorStatus?: number | null;
};

export type AgentStreamEvent =
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | {
      type: "input_required";
      sessionId: string;
      permissionId: string;
      title: string;
      kind: "permission" | "question";
    }
  | {
      type: "mode";
      startMode: AgentMode;
      currentMode: AgentMode;
      modeUpdatedAt?: string;
    };
