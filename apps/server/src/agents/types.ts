/**
 * Application-layer types for agent sessions and messages.
 *
 * These types extend the OpenCode SDK types with Synthetic-specific concerns:
 * - Track which construct owns a session (constructId, templateId)
 * - Add custom status tracking beyond SDK's session lifecycle
 * - Serialize SDK types into simplified API responses
 *
 * Note: These are NOT redundant with SDK types - they represent our domain model
 * on top of the OpenCode SDK primitives.
 */

import type { Event as OpencodeEvent, Part } from "@opencode-ai/sdk";

/**
 * Custom session statuses that track Synthetic-specific workflow states.
 * These are distinct from OpenCode SDK's internal session states.
 */
export const agentSessionStatuses = [
  "starting",
  "working",
  "awaiting_input",
  "completed",
  "error",
] as const;

export type AgentSessionStatus = (typeof agentSessionStatuses)[number];

/**
 * Message roles - subset of what OpenCode supports, focused on our use cases.
 */
export type AgentMessageRole = "user" | "assistant" | "system";

/**
 * Message states - our interpretation of OpenCode message lifecycle.
 */
export type AgentMessageState = "pending" | "streaming" | "completed" | "error";

/**
 * Application model for agent sessions.
 *
 * Extends OpenCode SDK's Session type with:
 * - constructId: Links session to a Synthetic construct
 * - templateId: Tracks which template config was used
 * - provider: AI provider (anthropic, openai, etc.)
 * - status: Custom workflow status tracking
 */
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

/**
 * Serialized/normalized messages for API responses.
 *
 * Simplifies OpenCode SDK's Message type by:
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
  parts: Part[]; // From OpenCode SDK
};

/**
 * Stream events sent over SSE to clients.
 * Combines our custom events (history, status) with OpenCode SDK events.
 */
export type AgentStreamEvent =
  | { type: "history"; messages: AgentMessageRecord[] }
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | OpencodeEvent;
