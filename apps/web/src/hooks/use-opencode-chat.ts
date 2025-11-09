import { createOpencodeClient } from "@opencode-ai/sdk";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SessionEventSubscription = Awaited<
  ReturnType<ReturnType<typeof createOpencodeClient>["event"]["subscribe"]>
>;

type ReadablePart = {
  type?: string;
  synthetic?: boolean;
  text?: string;
};

export type OpencodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  isComplete: boolean;
};

const READABLE_PART_TYPES = new Set(["text", "reasoning"]);

const isReadableTextPart = (part?: ReadablePart) =>
  Boolean(part && !part.synthetic && READABLE_PART_TYPES.has(part.type ?? ""));

export function useSessionChatMessages(
  events: OpencodeEvent[],
  initialMessages?: Array<{
    info: {
      id: string;
      role: "user" | "assistant";
      time: { created: number; completed?: number };
    };
    parts: Array<{
      id: string;
      messageID: string;
      type: string;
      text?: string;
      synthetic?: boolean;
    }>;
  }>
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: processing event stream requires branching
  useEffect(() => {
    const messageTexts = new Map<string, string>();
    const messageInfo = new Map<
      string,
      {
        role: "user" | "assistant";
        completed: boolean;
        timestamp: number;
      }
    >();

    // Load initial messages
    if (initialMessages) {
      for (const msg of initialMessages) {
        // Combine all readable text parts for this message
        const textParts = msg.parts.filter(isReadableTextPart);
        const fullText = textParts
          .map((p) => p.text || "")
          .filter(Boolean)
          .join("\n");

        if (fullText) {
          messageTexts.set(msg.info.id, fullText);
        }

        messageInfo.set(msg.info.id, {
          role: msg.info.role,
          completed:
            msg.info.role === "user"
              ? true
              : msg.info.time.completed !== undefined,
          timestamp: msg.info.time.completed || msg.info.time.created,
        });
      }
    }

    // Process streaming events (these will override/update initial messages)
    for (const event of events) {
      if (event.type === "message.part.updated") {
        const delta = event.properties?.delta as string | undefined;
        const part = event.properties?.part as
          | {
              id: string;
              messageID: string;
              type: string;
              text?: string;
              synthetic?: boolean;
              time?: {
                start: number;
                end?: number;
              };
            }
          | undefined;

        if (part && isReadableTextPart(part)) {
          if (delta) {
            const existingText = messageTexts.get(part.messageID) || "";
            messageTexts.set(part.messageID, existingText + delta);
          } else if (part.text) {
            messageTexts.set(part.messageID, part.text);
          }

          if (!messageInfo.has(part.messageID)) {
            messageInfo.set(part.messageID, {
              role: "assistant",
              completed: false,
              timestamp: part.time?.start || Date.now(),
            });
          }
        }
      }

      if (event.type === "message.updated") {
        const info = event.properties?.info as
          | {
              id: string;
              role: "user" | "assistant";
              time: {
                created: number;
                completed?: number;
              };
            }
          | undefined;

        if (info?.role) {
          messageInfo.set(info.id, {
            role: info.role,
            completed:
              info.role === "user" ? true : info.time.completed !== undefined,
            timestamp: info.time.completed || info.time.created,
          });
        }
      }
    }

    const messageIds = new Set([...messageInfo.keys(), ...messageTexts.keys()]);

    const newMessages: ChatMessage[] = [];
    for (const messageId of messageIds) {
      const text = messageTexts.get(messageId);
      if (!text) {
        continue;
      }

      const info = messageInfo.get(messageId);
      newMessages.push({
        id: messageId,
        role: info?.role ?? "assistant",
        text,
        timestamp: info?.timestamp ?? Date.now(),
        isComplete: info?.completed ?? false,
      });
    }

    newMessages.sort((a, b) => a.timestamp - b.timestamp);

    setMessages(newMessages);
  }, [events, initialMessages]);

  return messages;
}

export function useSessionEventStream(
  serverUrl: string,
  sessionId: string | null,
  enabled: boolean
) {
  const [events, setEvents] = useState<OpencodeEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!(sessionId && enabled)) {
      setEvents([]);
      setIsStreaming(false);
      return;
    }

    let cancelled = false;
    let subscription: SessionEventSubscription | null = null;

    const extractSessionId = (properties?: Record<string, unknown>) =>
      (properties?.sessionID as string | undefined) ||
      (properties?.sessionId as string | undefined) ||
      (properties?.session_id as string | undefined) ||
      (properties?.session as { id?: string } | undefined)?.id;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: event streaming requires multiple branches
    const connect = async () => {
      setIsStreaming(true);
      try {
        const client = createOpencodeClient({ baseUrl: serverUrl });
        subscription = await client.event.subscribe();

        for await (const event of subscription.stream) {
          if (cancelled) {
            break;
          }

          const eventSessionId = extractSessionId(event.properties);
          if (eventSessionId && eventSessionId !== sessionId) {
            continue;
          }

          setEvents((prev) => [
            ...prev,
            {
              type: event.type,
              properties: event.properties,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch {
        if (!cancelled) {
          toast.error("Failed to connect to event stream");
        }
      } finally {
        if (!cancelled) {
          setIsStreaming(false);
        }
      }
    };

    setEvents([]);
    connect();

    return () => {
      cancelled = true;
      setIsStreaming(false);
    };
  }, [serverUrl, sessionId, enabled]);

  return {
    events,
    isStreaming,
    clearEvents: () => setEvents([]),
  };
}
