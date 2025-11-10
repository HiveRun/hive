import type { AgentMessage, AgentMessagePart } from "@/queries/agents";

export type OpenCodeMessageInfo = {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
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
