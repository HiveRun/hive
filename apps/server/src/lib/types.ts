/**
 * Agent session status
 */
export type AgentStatus =
  | "starting"
  | "working"
  | "awaiting_input"
  | "completed"
  | "error";

/**
 * Agent provider (e.g., Anthropic, OpenAI)
 */
export type AgentProvider = "anthropic" | "openai" | "other";

/**
 * Agent message role
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * Agent message
 */
export type AgentMessage = {
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

/**
 * Agent session configuration
 */
export type AgentSessionConfig = {
  constructId: string;
  provider: AgentProvider;
  prompt: string;
  workingDirectory?: string;
};

/**
 * Agent session interface
 */
export type AgentSession = {
  id: string;
  constructId: string;
  provider: AgentProvider;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;

  /**
   * Send a message to the agent
   */
  sendMessage(content: string): Promise<void>;

  /**
   * Get message history
   */
  getMessages(): Promise<AgentMessage[]>;

  /**
   * Stop the agent session
   */
  stop(): Promise<void>;

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (status: AgentStatus) => void): () => void;

  /**
   * Subscribe to new messages
   */
  onMessage(callback: (message: AgentMessage) => void): () => void;
};

/**
 * Agent orchestration interface
 */
export type AgentOrchestrator = {
  /**
   * Create a new agent session
   */
  createSession(config: AgentSessionConfig): Promise<AgentSession>;

  /**
   * Get an existing session
   */
  getSession(sessionId: string): Promise<AgentSession | null>;

  /**
   * List all sessions for a construct
   */
  listSessions(constructId: string): Promise<AgentSession[]>;

  /**
   * Terminate a session
   */
  terminateSession(sessionId: string): Promise<void>;
};
