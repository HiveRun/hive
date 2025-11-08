import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_USE_MOCK_AGENT } from "@/config/agent";
import {
  type AgentMessage,
  type AgentSession,
  agentMutations,
  agentQueries,
} from "@/queries/agents";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const DEFAULT_USE_MOCK = DEFAULT_USE_MOCK_AGENT;

type AgentChatProps = {
  constructId: string;
};

export function AgentChat({ constructId }: AgentChatProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(agentQueries.sessionByConstruct(constructId));
  const session = sessionQuery.data ?? null;
  const messagesQuery = useQuery(agentQueries.messages(session?.id ?? null));
  const [message, setMessage] = useState("");
  const [useMock, setUseMock] = useState(DEFAULT_USE_MOCK);

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
      if (session?.id) {
        queryClient.invalidateQueries({
          queryKey: agentQueries.messages(session.id).queryKey,
        });
      }
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      toast.error(errorMessage);
    },
  });

  useEffect(() => {
    if (!session?.id) {
      return;
    }

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
        queryClient.setQueryData(messagesKey, normalized);
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent history";
        toast.error(title);
      }
    };

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: "message";
          message: AgentMessage;
        };
        const normalizedMessage = normalizeMessage(payload.message);
        queryClient.setQueryData<AgentMessage[] | undefined>(
          messagesKey,
          (prev) => {
            if (!prev) {
              return [normalizedMessage];
            }
            const index = prev.findIndex(
              (existing) => existing.id === normalizedMessage.id
            );
            if (index === -1) {
              return [...prev, normalizedMessage];
            }
            const next = [...prev];
            next[index] = normalizedMessage;
            return next;
          }
        );
      } catch (error) {
        const title =
          error instanceof Error
            ? error.message
            : "Failed to process agent message";
        toast.error(title);
      }
    };

    const handleStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: "status";
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

    eventSource.addEventListener("history", handleHistory);
    eventSource.addEventListener("message", handleMessage);
    eventSource.addEventListener("status", handleStatus);

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.removeEventListener("history", handleHistory);
      eventSource.removeEventListener("message", handleMessage);
      eventSource.removeEventListener("status", handleStatus);
      eventSource.close();
    };
  }, [constructId, queryClient, session?.id]);

  const handleStartSession = () => {
    startAgentMutation.mutate({
      constructId,
      useMock,
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
          <div className="flex items-center space-x-3">
            <Checkbox
              checked={useMock}
              id="use-mock-agent"
              onCheckedChange={(checked) => setUseMock(Boolean(checked))}
            />
            <Label className="text-sm" htmlFor="use-mock-agent">
              Use mock agent (no OpenCode credentials required)
            </Label>
          </div>
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
      ? message.parts
      : safeParseParts(message.parts as unknown),
  };
}

function safeParseParts(parts: unknown): unknown[] {
  if (Array.isArray(parts)) {
    return parts;
  }
  if (typeof parts === "string") {
    try {
      const parsed = JSON.parse(parts);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
