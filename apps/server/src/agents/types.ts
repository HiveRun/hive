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

import type { Event as OpencodeEvent } from "@opencode-ai/sdk";
import { t } from "elysia";

/**
 * Custom session statuses that track Synthetic-specific workflow states.
 * These are distinct from OpenCode SDK's internal session states.
 */
export const agentSessionStatuses = [
  "starting",
  "working",
  "awaiting_input",
  "idle",
  "completed",
  "error",
] as const;

export type AgentSessionStatus = (typeof agentSessionStatuses)[number];

/**
 * Message roles - subset of what OpenCode supports, focused on our use cases.
 */
export const agentMessageRoles = ["user", "assistant", "system"] as const;
export type AgentMessageRole = (typeof agentMessageRoles)[number];

/**
 * Message states - our interpretation of OpenCode message lifecycle.
 */
export const agentMessageStates = [
  "pending",
  "streaming",
  "completed",
  "error",
] as const;
export type AgentMessageState = (typeof agentMessageStates)[number];

/**
 * AgentSessionRecord schema - Application model for agent sessions.
 *
 * Extends OpenCode SDK's Session type with:
 * - constructId: Links session to a Synthetic construct
 * - templateId: Tracks which template config was used
 * - provider: AI provider (anthropic, openai, etc.)
 * - status: Custom workflow status tracking
 */
export const AgentSessionRecordSchema = t.Object({
  id: t.String(),
  constructId: t.String(),
  templateId: t.String(),
  provider: t.String(),
  status: t.Union(
    agentSessionStatuses.map((s) => t.Literal(s)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ]
  ),
  workspacePath: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  completedAt: t.Optional(t.String()),
});

export type AgentSessionRecord = typeof AgentSessionRecordSchema.static;

/**
 * AgentMessageRecord schema - Serialized/normalized messages for API responses.
 *
 * Simplifies OpenCode SDK's Message type by:
 * - Extracting text content from parts for convenience
 * - Adding state interpretation (pending, streaming, completed, error)
 * - Keeping parts array for detailed access when needed
 */
export const AgentMessageRecordSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  role: t.Union(
    agentMessageRoles.map((r) => t.Literal(r)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ]
  ),
  content: t.Union([t.String(), t.Null()]),
  state: t.Union(
    agentMessageStates.map((s) => t.Literal(s)) as [
      ReturnType<typeof t.Literal>,
      ...ReturnType<typeof t.Literal>[],
    ]
  ),
  createdAt: t.String(),
  parts: t.Array(t.Any()), // Part[] from OpenCode SDK
});

export type AgentMessageRecord = typeof AgentMessageRecordSchema.static;

/**
 * Stream events sent over SSE to clients.
 * Combines our custom events (history, status) with OpenCode SDK events.
 */
export type AgentStreamEvent =
  | { type: "history"; messages: AgentMessageRecord[] }
  | { type: "status"; status: AgentSessionStatus; error?: string }
  | OpencodeEvent;
