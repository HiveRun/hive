import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentMessage,
  type AgentMessagePart,
  type AgentSession,
  agentMutations,
  agentQueries,
} from "@/queries/agents";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

type PermissionRequest = {
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

type AgentChatProps = {
  constructId: string;
};

export function AgentChat({ constructId }: AgentChatProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(agentQueries.sessionByConstruct(constructId));
  const session = sessionQuery.data ?? null;
  const messagesQuery = useQuery(agentQueries.messages(session?.id ?? null));
  const [message, setMessage] = useState("");

  const startAgentMutation = useMutation({
    ...agentMutations.start,
    onSuccess: (newSession) => {
      queryClient.setQueryData(
        agentQueries.sessionByConstruct(constructId).queryKey,
        newSession
      );
      queryClient.invalidateQueries({
        queryKey: agentQueries.messages(newSession.id).queryKey,
      });
      toast.success("Agent session started");
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start agent";
      toast.error(errorMessage);
    },
  });

  const sendMessageMutation = useMutation({
    ...agentMutations.sendMessage,
    onSuccess: () => {
      setMessage("");
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      toast.error(errorMessage);
    },
  });

  const respondPermissionMutation = useMutation({
    ...agentMutations.respondPermission,
    onSuccess: () => {
      toast.success("Permission response sent");
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to respond to permission";
      toast.error(errorMessage);
    },
  });

  const handlePermissionResponse = (
    permissionId: string,
    response: "once" | "always" | "reject"
  ) => {
    if (!session?.id) {
      return;
    }
    respondPermissionMutation.mutate({
      sessionId: session.id,
      permissionId,
      response,
    });
  };

  const messageStoreRef = useRef<Map<string, AgentMessage>>(new Map());
  const messagePartsRef = useRef<Map<string, AgentMessagePart[]>>(new Map());
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);

  const updateMessagesCache = useCallback(() => {
    if (!session?.id) {
      return;
    }
    const sorted = [...messageStoreRef.current.values()].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    queryClient.setQueryData(
      agentQueries.messages(session.id).queryKey,
      sorted
    );
  }, [queryClient, session?.id]);

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
    (part: OpenCodePartPayload) => {
      const current = messagePartsRef.current.get(part.messageID) ?? [];
      const index = current.findIndex((existing) => existing.id === part.id);
      const nextParts = [...current];
      if (index === -1) {
        nextParts.push(part);
      } else {
        nextParts[index] = part;
      }
      messagePartsRef.current.set(part.messageID, nextParts);
      const info = messageStoreRef.current.get(part.messageID);
      if (info) {
        messageStoreRef.current.set(part.messageID, {
          ...info,
          parts: nextParts,
          content: extractTextFromParts(nextParts),
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
    if (!session?.id) {
      return;
    }

    messageStoreRef.current.clear();
    messagePartsRef.current.clear();
    setPermissions([]);

    const sessionKey = agentQueries.sessionByConstruct(constructId).queryKey;
    const messagesKey = agentQueries.messages(session.id).queryKey;
    const eventSource = new EventSource(
      `${API_BASE}/api/agents/sessions/${session.id}/events`
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
        };
        upsertPartRecord(payload.part);
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
    session?.id,
    applyMessageFromInfo,
    upsertMessageRecord,
    upsertPartRecord,
    removePartRecord,
  ]);

  const handleStartSession = () => {
    startAgentMutation.mutate({
      constructId,
    });
  };

  const handleSendMessage = () => {
    if (!(session?.id && message.trim())) {
      return;
    }
    sendMessageMutation.mutate({
      sessionId: session.id,
      content: message.trim(),
    });
  };

  const isStarting = startAgentMutation.isPending;
  const isSending = sendMessageMutation.isPending;

  if (sessionQuery.isPending) {
    return (
      <Card>
        <CardContent className="p-6">Loading agent session...</CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            No agent is currently running for this construct. Start a session to
            chat with the workspace agent.
          </p>
          <Button
            disabled={isStarting}
            onClick={handleStartSession}
            type="button"
          >
            {isStarting ? "Starting..." : "Start Agent Session"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const messages = messagesQuery.data ?? [];

  const renderConversation = () => {
    if (messagesQuery.isPending) {
      return (
        <p className="text-muted-foreground text-sm">Loading conversation...</p>
      );
    }

    if (messages.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          No messages yet. Say hello to get started.
        </p>
      );
    }

    return messages
      .slice()
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .map((chatMessage) => (
        <MessageBubble key={chatMessage.id} message={chatMessage} />
      ));
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Agent Session</CardTitle>
          <Badge variant="secondary">{session.status}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Provider: {session.provider}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex-1 space-y-3 overflow-y-auto rounded-md border p-4">
          {renderConversation()}
        </div>
        {permissions.length > 0 && (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <div className="space-y-1">
              <p className="font-medium text-sm">Agent Permissions</p>
              <p className="text-muted-foreground text-xs">
                The agent needs approval to continue. Review each request below.
              </p>
            </div>
            {permissions.map((permission) => (
              <div
                className="rounded-md border bg-muted/40 p-3 text-sm"
                key={permission.id}
              >
                <p className="font-semibold">{permission.title}</p>
                <p className="text-muted-foreground text-xs">
                  {permission.type}
                  {permission.pattern
                    ? ` · ${Array.isArray(permission.pattern) ? permission.pattern.join(", ") : permission.pattern}`
                    : ""}
                </p>
                {permission.metadata && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-background p-2 text-xs">
                    {JSON.stringify(permission.metadata, null, 2)}
                  </pre>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    disabled={respondPermissionMutation.isPending}
                    onClick={() =>
                      handlePermissionResponse(permission.id, "once")
                    }
                    size="sm"
                    variant="secondary"
                  >
                    Allow Once
                  </Button>
                  <Button
                    disabled={respondPermissionMutation.isPending}
                    onClick={() =>
                      handlePermissionResponse(permission.id, "always")
                    }
                    size="sm"
                    variant="secondary"
                  >
                    Always Allow
                  </Button>
                  <Button
                    disabled={respondPermissionMutation.isPending}
                    onClick={() =>
                      handlePermissionResponse(permission.id, "reject")
                    }
                    size="sm"
                    variant="destructive"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="agent-message">Message</Label>
          <Textarea
            className="min-h-[120px]"
            disabled={isSending}
            id="agent-message"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === "Enter" &&
                !isSending
              ) {
                event.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Share context, ask for progress, or provide feedback..."
            value={message}
          />
          <p className="text-muted-foreground text-xs">
            Press Ctrl+Enter (or ⌘+Enter) to send.
          </p>
          <div className="flex justify-end">
            <Button
              disabled={isSending || !message.trim()}
              onClick={handleSendMessage}
              type="button"
            >
              {isSending ? "Sending..." : "Send Message"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const createdAt = useMemo(() => {
    try {
      return new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return message.createdAt;
    }
  }, [message.createdAt]);

  const alignment = message.role === "assistant" ? "items-start" : "items-end";
  const bubbleStyles =
    message.role === "assistant"
      ? "bg-muted text-foreground"
      : "bg-primary text-primary-foreground";

  return (
    <div className={`flex flex-col ${alignment} gap-2`}>
      <div className={`rounded-lg px-4 py-2 text-sm ${bubbleStyles}`}>
        <div className="mb-1 font-semibold capitalize">{message.role}</div>
        {message.content ? (
          <p className="whitespace-pre-line leading-relaxed">
            {message.content}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs italic">
            No text content
          </p>
        )}
      </div>
      <span className="text-muted-foreground text-xs">{createdAt}</span>
    </div>
  );
}

function normalizeMessage(message: AgentMessage): AgentMessage {
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

type OpenCodeMessageInfo = {
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

type OpenCodePartPayload = AgentMessagePart & {
  type: string;
  text?: string;
};

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

function extractTextFromParts(parts: AgentMessagePart[]): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }
  return parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n");
}
