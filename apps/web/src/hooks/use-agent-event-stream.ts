import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  computeContentFromParts,
  extractTextFromParts,
  normalizeMessage,
  type OpenCodeMessageInfo,
  type OpenCodePartPayload,
  upsertPartWithDelta,
} from "@/lib/agent-message-utils";
import type {
  AgentMessage,
  AgentMessagePart,
  AgentSession,
} from "@/queries/agents";
import { agentQueries } from "@/queries/agents";

const envApiUrl = import.meta.env.VITE_API_URL?.trim();
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let apiBase: string | undefined;

if (envApiUrl && envApiUrl !== "undefined") {
  apiBase = envApiUrl;
} else if (isTauri) {
  apiBase = "http://localhost:3000";
} else if (typeof window !== "undefined") {
  apiBase = window.location.origin;
}

const API_BASE = apiBase ?? "http://localhost:3000";
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_BACKOFF_FACTOR = 2;

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

export type CompactionStats = {
  count: number;
  lastCompactionAt: string | null;
};

const defaultCompactionStats: CompactionStats = {
  count: 0,
  lastCompactionAt: null,
};

export const COMPACTION_WARNING_THRESHOLD = 3;

type AgentEventStreamOptions = {
  enabled?: boolean;
};

export function useAgentEventStream(
  sessionId: string | null,
  cellId: string,
  options?: AgentEventStreamOptions
) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;
  const messageStoreRef = useRef<Map<string, AgentMessage>>(new Map());
  const messagePartsRef = useRef<Map<string, AgentMessagePart[]>>(new Map());
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [compaction, setCompaction] = useState<CompactionStats>(
    defaultCompactionStats
  );

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
      const nextParts = upsertPartWithDelta(current, part, delta);
      messagePartsRef.current.set(part.messageID, nextParts);

      const info = messageStoreRef.current.get(part.messageID);
      if (info) {
        const nextContent = computeContentFromParts(nextParts);
        messageStoreRef.current.set(part.messageID, {
          ...info,
          parts: nextParts,
          content: nextContent,
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
    if (!(sessionId && enabled)) {
      messageStoreRef.current.clear();
      messagePartsRef.current.clear();
      setPermissions([]);
      setCompaction(defaultCompactionStats);
      return;
    }

    messageStoreRef.current.clear();
    messagePartsRef.current.clear();
    setPermissions([]);
    setCompaction(defaultCompactionStats);

    const sessionKey = agentQueries.sessionByCell(cellId).queryKey;
    const messagesKey = agentQueries.messages(sessionId).queryKey;
    let eventSource: EventSource | null = null;
    let reconnectTimeout: number | null = null;
    let reconnectAttempts = 0;
    let isActive = true;

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

    const handleCompactionStats = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as Partial<CompactionStats>;
        setCompaction((previous) => {
          const nextCount =
            typeof payload.count === "number" ? payload.count : previous.count;
          const nextLast =
            typeof payload.lastCompactionAt === "string"
              ? payload.lastCompactionAt
              : previous.lastCompactionAt;
          const next = { count: nextCount, lastCompactionAt: nextLast };
          if (
            previous.count !== next.count &&
            next.count >= COMPACTION_WARNING_THRESHOLD
          ) {
            toast.warning(
              `Context compacted ${next.count} times. Expect reduced recall.`
            );
          }
          return next;
        });
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process compaction stats";
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

    const handleSessionDiff = () => {
      queryClient.invalidateQueries({
        queryKey: ["cell-diff", cellId],
      });
    };

    const attachListeners = (source: EventSource) => {
      source.addEventListener("history", handleHistory);
      source.addEventListener("message", handleLegacyMessage);
      source.addEventListener("message.updated", handleMessageUpdated);
      source.addEventListener("message.part.updated", handleMessagePartUpdated);
      source.addEventListener("message.part.removed", handleMessagePartRemoved);
      source.addEventListener("status", handleStatus);
      source.addEventListener("permission.updated", handlePermissionUpdated);
      source.addEventListener("permission.replied", handlePermissionReplied);
      source.addEventListener("session.compaction", handleCompactionStats);
      source.addEventListener("session.diff", handleSessionDiff);
    };

    const detachListeners = (source: EventSource) => {
      source.removeEventListener("history", handleHistory);
      source.removeEventListener("message", handleLegacyMessage);
      source.removeEventListener("message.updated", handleMessageUpdated);
      source.removeEventListener(
        "message.part.updated",
        handleMessagePartUpdated
      );
      source.removeEventListener(
        "message.part.removed",
        handleMessagePartRemoved
      );
      source.removeEventListener("status", handleStatus);
      source.removeEventListener("permission.updated", handlePermissionUpdated);
      source.removeEventListener("permission.replied", handlePermissionReplied);
      source.removeEventListener("session.compaction", handleCompactionStats);
      source.removeEventListener("session.diff", handleSessionDiff);
    };

    const resetReconnect = () => {
      reconnectAttempts = 0;
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const scheduleReconnect = () => {
      if (!isActive || reconnectTimeout !== null) {
        return;
      }
      reconnectAttempts += 1;
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS *
          RECONNECT_BACKOFF_FACTOR ** (reconnectAttempts - 1),
        RECONNECT_MAX_DELAY_MS
      );
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!isActive) {
        return;
      }
      const source = new EventSource(
        `${API_BASE}/api/agents/sessions/${sessionId}/events`
      );
      eventSource = source;
      attachListeners(source);
      source.onopen = () => {
        resetReconnect();
      };
      source.onerror = () => {
        detachListeners(source);
        source.close();
        if (eventSource === source) {
          eventSource = null;
        }
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      isActive = false;
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
      if (eventSource) {
        detachListeners(eventSource);
        eventSource.close();
      }
    };
  }, [
    cellId,
    queryClient,
    sessionId,
    applyMessageFromInfo,
    upsertMessageRecord,
    upsertPartRecord,
    removePartRecord,
    enabled,
  ]);

  return { permissions, compaction };
}

function composeAgentMessage(
  info: OpenCodeMessageInfo,
  parts: AgentMessagePart[]
): AgentMessage {
  return normalizeMessage({
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    parentId: info.parentID ?? null,
    errorName: info.error?.name ?? null,
    errorMessage: info.error?.data?.message ?? null,
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
