import type { Part } from "@opencode-ai/sdk";

export const agentSessionStatuses = [
  "starting",
  "working",
  "awaiting_input",
  "idle",
  "completed",
  "error",
] as const;

export type AgentSessionStatus = (typeof agentSessionStatuses)[number];

export type AgentMessageRole = "user" | "assistant" | "system";
export type AgentMessageState = "pending" | "streaming" | "completed" | "error";

export type AgentSessionRecord = {
  id: string;
  constructId: string;
  templateId: string;
  provider: string;
  status: AgentSessionStatus;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AgentMessageRecord = {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string | null;
  state: AgentMessageState;
  createdAt: string;
  parts: Part[];
};

export type AgentStreamEvent =
  | { type: "message"; message: AgentMessageRecord }
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | { type: "history"; messages: AgentMessageRecord[] };
