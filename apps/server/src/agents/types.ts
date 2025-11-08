import type { AgentMessage, AgentSession } from "../schema/agents";

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

export type AgentSessionRecord = AgentSession;
export type AgentMessageRecord = AgentMessage;

export type AgentStreamEvent =
  | { type: "message"; message: AgentMessageRecord }
  | { type: "status"; status: AgentSessionStatus; error?: string };
