export type AgentSessionStatus =
  | "starting"
  | "working"
  | "awaiting_input"
  | "completed"
  | "error";

export type AgentSession = {
  id: string;
  constructId: string;
  sessionId: string;
  provider: string;
  status: AgentSessionStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
  errorMessage: string | null;
  metadata: unknown;
};

export type AgentMessageRole = "user" | "assistant" | "system";

export type AgentMessage = {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string;
  timestamp: string | Date;
  metadata: unknown;
};
