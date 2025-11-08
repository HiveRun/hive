import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { agentMessages, agentSessions } from "../schema/agents";
import { constructs } from "../schema/constructs";
import type {
  AgentMessageRecord,
  AgentMessageRole,
  AgentMessageState,
  AgentSessionRecord,
  AgentSessionStatus,
} from "./types";

export async function getConstructById(constructId: string) {
  const [construct] = await db
    .select()
    .from(constructs)
    .where(eq(constructs.id, constructId))
    .limit(1);
  return construct ?? null;
}

export async function getAgentSessionById(
  sessionId: string
): Promise<AgentSessionRecord | null> {
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  return session ?? null;
}

export async function getAgentSessionByConstructId(
  constructId: string
): Promise<AgentSessionRecord | null> {
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.constructId, constructId))
    .orderBy(desc(agentSessions.createdAt))
    .limit(1);
  return session ?? null;
}

export async function createAgentSessionRecord(input: {
  id?: string;
  constructId: string;
  templateId: string;
  workspacePath: string;
  provider: string;
  status: AgentSessionStatus;
  opencodeSessionId: string;
}): Promise<AgentSessionRecord> {
  const now = new Date();
  const [session] = await db
    .insert(agentSessions)
    .values({
      id: input.id ?? randomUUID(),
      constructId: input.constructId,
      templateId: input.templateId,
      workspacePath: input.workspacePath,
      provider: input.provider,
      status: input.status,
      opencodeSessionId: input.opencodeSessionId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!session) {
    throw new Error("Failed to persist agent session");
  }

  return session;
}

export async function updateAgentSessionStatus(
  sessionId: string,
  status: AgentSessionStatus,
  options?: { error?: string | null; completed?: boolean }
): Promise<void> {
  const updates: Partial<typeof agentSessions.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };

  if (typeof options?.error !== "undefined") {
    updates.lastError = options.error ?? null;
  }

  if (options?.completed) {
    updates.completedAt = new Date();
  }

  await db
    .update(agentSessions)
    .set(updates)
    .where(eq(agentSessions.id, sessionId));
}

export async function createAgentMessageRecord(input: {
  sessionId: string;
  role: AgentMessageRole;
  content?: string | null;
  parts?: string | null;
  state: AgentMessageState;
  opencodeMessageId?: string | null;
}): Promise<AgentMessageRecord> {
  const now = new Date();
  const [message] = await db
    .insert(agentMessages)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content ?? null,
      parts: input.parts ?? null,
      state: input.state,
      opencodeMessageId: input.opencodeMessageId ?? null,
      createdAt: now,
      sequence: Date.now(),
    })
    .returning();

  if (!message) {
    throw new Error("Failed to persist agent message");
  }

  return message;
}

export async function upsertAgentMessageRecord(input: {
  sessionId: string;
  opencodeMessageId: string;
  role: AgentMessageRole;
  content?: string | null;
  parts?: string | null;
  state: AgentMessageState;
}): Promise<AgentMessageRecord> {
  const existing = await db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.sessionId, input.sessionId),
        eq(agentMessages.opencodeMessageId, input.opencodeMessageId)
      )
    )
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(agentMessages)
      .set({
        content: input.content ?? existing[0].content,
        parts: input.parts ?? existing[0].parts,
        state: input.state,
      })
      .where(eq(agentMessages.id, existing[0].id))
      .returning();
    if (!updated) {
      throw new Error("Failed to update agent message");
    }
    return updated;
  }

  return createAgentMessageRecord({
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    parts: input.parts,
    state: input.state,
    opencodeMessageId: input.opencodeMessageId,
  });
}

export function listAgentMessages(
  sessionId: string
): Promise<AgentMessageRecord[]> {
  return db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(agentMessages.sequence);
}

export async function linkLatestUserMessageToOpencode(
  sessionId: string,
  opencodeMessageId: string,
  options?: { content?: string | null; parts?: string | null }
): Promise<AgentMessageRecord | null> {
  const [pending] = await db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.sessionId, sessionId),
        eq(agentMessages.role, "user"),
        isNull(agentMessages.opencodeMessageId)
      )
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);

  if (!pending) {
    return null;
  }

  const [updated] = await db
    .update(agentMessages)
    .set({
      opencodeMessageId,
      content: options?.content ?? pending.content,
      parts: options?.parts ?? pending.parts,
    })
    .where(eq(agentMessages.id, pending.id))
    .returning();

  return updated ?? null;
}
