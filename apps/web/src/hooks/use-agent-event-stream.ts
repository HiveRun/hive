import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  extractTextFromParts,
  normalizeMessage,
  type OpenCodeMessageInfo,
  type OpenCodePartPayload,
} from "@/lib/agent-message-utils";
import type {
  AgentMessage,
  AgentMessagePart,
  AgentSession,
} from "@/queries/agents";
import { agentQueries } from "@/queries/agents";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

export type PermissionRequest = {
  id: string;
  sessionID: string;
  title: string;
  type: string;
  metadata?: Record<string, unknown>;
  pattern?: string | string[];
  time: {
    created: number;
  };
};

export function useAgentEventStream(
  sessionId: string | null,
  constructId: string
) {
  const queryClient = useQueryClient();
  const messageStoreRef = useRef<Map<string, AgentMessage>>(new Map());
  const messagePartsRef = useRef<Map<string, AgentMessagePart[]>>(new Map());
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);

  const updateMessagesCache = useCallback(() => {
    if (!sessionId) {
      return;
    }
    const sorted = [...messageStoreRef.current.values()].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    queryClient.setQueryData(agentQueries.messages(sessionId).queryKey, sorted);
  }, [queryClient, sessionId]);

  const applyMessageFromInfo = useCallback(
    (info: OpenCodeMessageInfo) => {
      const existingParts = messagePartsRef.current.get(info.id) ?? [];
      const normalized = composeAgentMessage(info, existingParts);
      messageStoreRef.current.set(normalized.id, normalized);
      updateMessagesCache();
    },
    [updateMessagesCache]
  );

  const upsertMessageRecord = useCallback(
    (record: AgentMessage) => {
      const normalized = normalizeMessage(record);
      messageStoreRef.current.set(normalized.id, normalized);
      messagePartsRef.current.set(normalized.id, normalized.parts ?? []);
      updateMessagesCache();
    },
    [updateMessagesCache]
  );

  const upsertPartRecord = useCallback(
    (part: OpenCodePartPayload, delta?: string) => {
      const current = messagePartsRef.current.get(part.messageID) ?? [];
      const index = current.findIndex((existing) => existing.id === part.id);
      const existingPart = index === -1 ? undefined : current[index];

      const hasDelta = typeof delta === "string" && delta.length > 0;
      const baseText = existingPart?.text ?? part.text ?? "";
      const text = hasDelta
        ? `${baseText}${delta}`
        : (part.text ?? existingPart?.text);

      const updatedPart: AgentMessagePart = {
        ...existingPart,
        ...part,
        text: text ?? undefined,
      };

      const nextParts = [...current];
      if (index === -1) {
        nextParts.push(updatedPart);
      } else {
        nextParts[index] = updatedPart;
      }
      messagePartsRef.current.set(part.messageID, nextParts);

      const info = messageStoreRef.current.get(part.messageID);
      if (info) {
        const nextContent = extractTextFromParts(nextParts);
        messageStoreRef.current.set(part.messageID, {
          ...info,
          parts: nextParts,
          content: nextContent.length ? nextContent : null,
        });
        updateMessagesCache();
      }
    },
    [updateMessagesCache]
  );

  const removePartRecord = useCallback(
    (messageId: string, partId: string) => {
      const current = messagePartsRef.current.get(messageId);
      if (!current) {
        return;
      }
      const next = current.filter((part) => part.id !== partId);
      messagePartsRef.current.set(messageId, next);
      const info = messageStoreRef.current.get(messageId);
      if (info) {
        messageStoreRef.current.set(messageId, {
          ...info,
          parts: next,
          content: extractTextFromParts(next),
        });
        updateMessagesCache();
      }
    },
    [updateMessagesCache]
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    messageStoreRef.current.clear();
    messagePartsRef.current.clear();
    setPermissions([]);

    const sessionKey = agentQueries.sessionByConstruct(constructId).queryKey;
    const messagesKey = agentQueries.messages(sessionId).queryKey;
    const eventSource = new EventSource(
      `${API_BASE}/api/agents/sessions/${sessionId}/events`
    );

    const handleHistory = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          messages: AgentMessage[];
        };
        const normalized = payload.messages.map(normalizeMessage);
        messageStoreRef.current = new Map(
          normalized.map((msg) => [msg.id, msg])
        );
        messagePartsRef.current = new Map(
          normalized.map((msg) => [msg.id, msg.parts ?? []])
        );
        queryClient.setQueryData(messagesKey, normalized);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent history";
        toast.error(title);
      }
    };

    const handleLegacyMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          message: AgentMessage;
        };
        upsertMessageRecord(payload.message);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent message";
        toast.error(title);
      }
    };

    const handleMessageUpdated = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          info: OpenCodeMessageInfo;
        };
        applyMessageFromInfo(payload.info);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent message";
        toast.error(title);
      }
    };

    const handleMessagePartUpdated = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          part: OpenCodePartPayload;
          delta?: string;
        };
        upsertPartRecord(payload.part, payload.delta);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process message part";
        toast.error(title);
      }
    };

    const handleMessagePartRemoved = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          sessionID: string;
          messageID: string;
          partID: string;
        };
        removePartRecord(payload.messageID, payload.partID);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process removed part";
        toast.error(title);
      }
    };

    const handleStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          status: string;
          error?: string;
        };
        queryClient.setQueryData<AgentSession | null | undefined>(
          sessionKey,
          (prev) => {
            if (!prev) {
              return prev;
            }
            return {
              ...prev,
              status: payload.status,
            };
          }
        );
        if (payload.error) {
          toast.error(payload.error);
        }
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent status";
        toast.error(title);
      }
    };

    const handlePermissionUpdated = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as PermissionRequest;
        setPermissions((prev) => {
          const exists = prev.some((item) => item.id === payload.id);
          if (exists) {
            return prev.map((item) =>
              item.id === payload.id ? payload : item
            );
          }
          return [...prev, payload];
        });
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process permission";
        toast.error(title);
      }
    };

    const handlePermissionReplied = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          permissionID: string;
        };
        setPermissions((prev) =>
          prev.filter((permission) => permission.id !== payload.permissionID)
        );
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process permission response";
        toast.error(title);
      }
    };

    eventSource.addEventListener("history", handleHistory);
    eventSource.addEventListener("message", handleLegacyMessage);
    eventSource.addEventListener("message.updated", handleMessageUpdated);
    eventSource.addEventListener(
      "message.part.updated",
      handleMessagePartUpdated
    );
    eventSource.addEventListener(
      "message.part.removed",
      handleMessagePartRemoved
    );
    eventSource.addEventListener("status", handleStatus);
    eventSource.addEventListener("permission.updated", handlePermissionUpdated);
    eventSource.addEventListener("permission.replied", handlePermissionReplied);

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.removeEventListener("history", handleHistory);
      eventSource.removeEventListener("message", handleLegacyMessage);
      eventSource.removeEventListener("message.updated", handleMessageUpdated);
      eventSource.removeEventListener(
        "message.part.updated",
        handleMessagePartUpdated
      );
      eventSource.removeEventListener(
        "message.part.removed",
        handleMessagePartRemoved
      );
      eventSource.removeEventListener("status", handleStatus);
      eventSource.removeEventListener(
        "permission.updated",
        handlePermissionUpdated
      );
      eventSource.removeEventListener(
        "permission.replied",
        handlePermissionReplied
      );
      eventSource.close();
    };
  }, [
    constructId,
    queryClient,
    sessionId,
    applyMessageFromInfo,
    upsertMessageRecord,
    upsertPartRecord,
    removePartRecord,
  ]);

  return { permissions };
}

function composeAgentMessage(
  info: OpenCodeMessageInfo,
  parts: AgentMessagePart[]
): AgentMessage {
  return normalizeMessage({
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    content: extractTextFromParts(parts),
    state: deriveMessageState(info),
    createdAt: new Date(info.time.created).toISOString(),
    parts,
  });
}

function deriveMessageState(info: OpenCodeMessageInfo): string {
  if (info.role === "assistant" && info.error) {
    return "error";
  }
  if (info.role === "assistant" && !info.time.completed) {
    return "streaming";
  }
  return "completed";
}
