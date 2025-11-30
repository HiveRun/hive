import type { AgentMessage, AgentMessagePart } from "@/queries/agents";

export type OpenCodeMessageInfo = {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  parentID?: string;
  time: {
    created: number;
    completed?: number;
  };
  error?: {
    name: string;
    data?: {
      message?: string;
    };
  };
};

export type OpenCodePartPayload = AgentMessagePart & {
  type: string;
  text?: string;
  messageID: string;
  delta?: string;
};

export function normalizeMessage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    content: message.content ?? null,
    parentId: message.parentId ?? null,
    errorName: message.errorName ?? null,
    errorMessage: message.errorMessage ?? null,
    parts: Array.isArray(message.parts)
      ? (message.parts as AgentMessagePart[])
      : safeParseParts(message.parts as unknown),
  };
}

function safeParseParts(parts: unknown): AgentMessagePart[] {
  if (Array.isArray(parts)) {
    return parts as AgentMessagePart[];
  }
  if (typeof parts === "string") {
    try {
      const parsed = JSON.parse(parts);
      return Array.isArray(parsed) ? (parsed as AgentMessagePart[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }
  return parts
    .filter(
      (part: unknown) =>
        (part as { type: string }).type === "text" ||
        (part as { type: string }).type === "reasoning"
    )
    .map((part: unknown) => (part as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
}

export function mergePartWithDelta(
  incoming: OpenCodePartPayload,
  existing?: AgentMessagePart,
  delta?: string
): AgentMessagePart {
  const hasDelta = typeof delta === "string" && delta.length > 0;
  const baseText = existing?.text ?? incoming.text ?? "";
  const text = hasDelta
    ? `${baseText}${delta}`
    : (incoming.text ?? existing?.text);

  return {
    ...existing,
    ...incoming,
    ...(text !== undefined ? { text } : {}),
  };
}

export function upsertPartWithDelta(
  parts: AgentMessagePart[],
  incoming: OpenCodePartPayload,
  delta?: string
): AgentMessagePart[] {
  const nextParts = [...parts];
  const index = nextParts.findIndex((part) => part.id === incoming.id);
  const existing = index === -1 ? undefined : nextParts[index];
  const updatedPart = mergePartWithDelta(incoming, existing, delta);

  if (index === -1) {
    nextParts.push(updatedPart);
  } else {
    nextParts[index] = updatedPart;
  }

  return nextParts;
}

export function computeContentFromParts(
  parts: AgentMessagePart[]
): string | null {
  const text = extractTextFromParts(parts);
  return text.length ? text : null;
}
