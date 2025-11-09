import { createOpencodeClient } from "@opencode-ai/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { opencodeMutations, opencodeQueries } from "@/queries/opencode";

export const Route = createFileRoute("/opencode-test")({
  component: OpencodeTestComponent,
});

const DEFAULT_PORT = 5006;
const COPY_FEEDBACK_DURATION = 2000;
const STATUS_REFETCH_INTERVAL = 5000;
const SESSIONS_REFETCH_INTERVAL = 5000;

type Session = {
  id: string;
  title?: string;
};

type OpencodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  isComplete: boolean;
};

type SessionEventSubscription = Awaited<
  ReturnType<ReturnType<typeof createOpencodeClient>["event"]["subscribe"]>
>;

function useSessionChatMessages(
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
        // Combine all text parts for this message
        const textParts = msg.parts.filter(
          (p) => p.type === "text" && !p.synthetic
        );
        const fullText = textParts.map((p) => p.text || "").join("");

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

        if (part?.type === "text" && !part.synthetic) {
          if (delta) {
            const existingText = messageTexts.get(part.messageID) || "";
            messageTexts.set(part.messageID, existingText + delta);
          } else if (part.text) {
            messageTexts.set(part.messageID, part.text);
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

    const newMessages: ChatMessage[] = [];
    for (const [messageId, info] of messageInfo.entries()) {
      const text = messageTexts.get(messageId);
      if (text) {
        newMessages.push({
          id: messageId,
          role: info.role,
          text,
          timestamp: info.timestamp,
          isComplete: info.completed,
        });
      }
    }

    setMessages(newMessages);
  }, [events, initialMessages]);

  return messages;
}

function useSessionEventStream(
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

function OpencodeTestComponent() {
  const queryClient = useQueryClient();
  const [port, setPort] = useState(DEFAULT_PORT);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<"chat" | "events">("chat");

  const serverUrl = `http://127.0.0.1:${port}`;

  const { data: status, refetch } = useQuery({
    ...opencodeQueries.status(port),
    refetchInterval: STATUS_REFETCH_INTERVAL,
  });

  const { data: sessions, refetch: refetchSessions } = useQuery({
    ...opencodeQueries.sessions(serverUrl),
    enabled: status?.active ?? false,
    refetchInterval: status?.active ? SESSIONS_REFETCH_INTERVAL : false,
  });

  const { data: initialMessages } = useQuery({
    ...opencodeQueries.sessionMessages(serverUrl, selectedSessionId || ""),
    enabled: Boolean(status?.active && selectedSessionId),
  });

  const { events, isStreaming, clearEvents } = useSessionEventStream(
    serverUrl,
    selectedSessionId,
    status?.active ?? false
  );

  const chatMessages = useSessionChatMessages(events, initialMessages);

  const initMutation = useMutation({
    ...opencodeMutations.init,
    onSuccess: (data) => {
      toast.success(data.message);
      queryClient.invalidateQueries({
        queryKey: ["opencode", "status", port],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const shutdownMutation = useMutation({
    ...opencodeMutations.shutdown,
    onSuccess: (data) => {
      toast.success(data.message);
      queryClient.invalidateQueries({
        queryKey: ["opencode", "status", port],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const createSessionMutation = useMutation({
    ...opencodeMutations.createSession,
    onSuccess: (data) => {
      toast.success(`Session created: ${data.title || data.id}`);
      setSessionTitle("");
      queryClient.invalidateQueries({
        queryKey: ["opencode", "sessions", serverUrl],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCopyCommand = async (command: string, label: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      toast.success(`${label} copied to clipboard!`);
      setTimeout(() => setCopiedCommand(null), COPY_FEEDBACK_DURATION);
    } catch {
      toast.error("Failed to copy command");
    }
  };

  const handleToggleEventStream = (sessionId: string) => {
    const nextSession = selectedSessionId === sessionId ? null : sessionId;
    setSelectedSessionId(nextSession);
    clearEvents();
  };

  const connectCommand = `opencode attach http://127.0.0.1:${port}`;
  const isServerActive = Boolean(status?.active);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-8 font-bold text-3xl">OpenCode Server Test</h1>

      <div className="grid gap-6">
        <ServerConfigurationCard
          isServerActive={isServerActive}
          isShuttingDown={shutdownMutation.isPending}
          isSpawning={initMutation.isPending}
          onPortChange={setPort}
          onShutdown={() => shutdownMutation.mutate(port)}
          onSpawn={() => initMutation.mutate(port)}
          port={port}
        />

        <ServerHealthCard
          isActive={isServerActive}
          onRefresh={() => refetch()}
          serverUrl={status?.serverUrl}
          statusMessage={status?.message}
        />

        {isServerActive && (
          <>
            <ConnectionCommandCard
              command={connectCommand}
              copiedCommand={copiedCommand}
              onCopy={handleCopyCommand}
            />

            <SessionsCard
              copiedCommand={copiedCommand}
              isCreating={createSessionMutation.isPending}
              onCopySessionId={(sessionId) =>
                handleCopyCommand(sessionId, "Session ID")
              }
              onCreateSession={() =>
                createSessionMutation.mutate({
                  baseUrl: serverUrl,
                  title: sessionTitle || undefined,
                })
              }
              onRefresh={() => refetchSessions()}
              onSessionTitleChange={setSessionTitle}
              onToggleEvents={handleToggleEventStream}
              onViewModeChange={setViewMode}
              port={port}
              selectedSessionId={selectedSessionId}
              sessions={sessions}
              sessionTitle={sessionTitle}
              viewMode={viewMode}
            />

            {selectedSessionId && viewMode === "chat" && (
              <ChatMessagesCard
                isStreaming={isStreaming}
                messages={chatMessages}
                onClear={clearEvents}
              />
            )}

            {selectedSessionId && viewMode === "events" && (
              <EventStreamCard
                events={events}
                isStreaming={isStreaming}
                onClear={clearEvents}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

type ServerConfigurationCardProps = {
  port: number;
  onPortChange: (value: number) => void;
  onSpawn: () => void;
  onShutdown: () => void;
  isSpawning: boolean;
  isShuttingDown: boolean;
  isServerActive: boolean;
};

function ServerConfigurationCard({
  port,
  onPortChange,
  onSpawn,
  onShutdown,
  isSpawning,
  isShuttingDown,
  isServerActive,
}: ServerConfigurationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            onChange={(e) => onPortChange(Number(e.target.value))}
            placeholder="5006"
            type="number"
            value={port}
          />
        </div>

        <div className="flex gap-2">
          <Button disabled={isSpawning || isServerActive} onClick={onSpawn}>
            {isSpawning ? "Spawning..." : "Spawn Server"}
          </Button>

          <Button
            disabled={isShuttingDown || !isServerActive}
            onClick={onShutdown}
            variant="destructive"
          >
            {isShuttingDown ? "Shutting down..." : "Shutdown"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type ServerHealthCardProps = {
  isActive: boolean;
  serverUrl?: string;
  statusMessage?: string;
  onRefresh: () => void;
};

function ServerHealthCard({
  isActive,
  serverUrl,
  statusMessage,
  onRefresh,
}: ServerHealthCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${
                isActive ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="font-medium">
              {isActive ? "Running" : "Stopped"}
            </span>
          </div>

          <Button onClick={onRefresh} size="sm" variant="outline">
            Refresh
          </Button>
        </div>

        {serverUrl && (
          <div className="space-y-1">
            <Label>Server URL</Label>
            <p className="font-mono text-sm">{serverUrl}</p>
          </div>
        )}

        <div className="space-y-1">
          <Label>Status Message</Label>
          <p className="text-muted-foreground text-sm">{statusMessage}</p>
        </div>
      </CardContent>
    </Card>
  );
}

type ConnectionCommandCardProps = {
  command: string;
  copiedCommand: string | null;
  onCopy: (command: string, label: string) => void;
};

function ConnectionCommandCard({
  command,
  copiedCommand,
  onCopy,
}: ConnectionCommandCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to Server</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>General Connection Command</Label>
          <div className="flex gap-2">
            <Input className="font-mono text-sm" readOnly value={command} />
            <Button onClick={() => onCopy(command, "Command")}>
              {copiedCommand === command ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <p className="font-medium text-sm">
            This connects to the server without a specific session.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

type SessionsCardProps = {
  sessions?: Session[];
  sessionTitle: string;
  onSessionTitleChange: (value: string) => void;
  onCreateSession: () => void;
  isCreating: boolean;
  onRefresh: () => void;
  copiedCommand: string | null;
  onCopySessionId: (sessionId: string) => void;
  port: number;
  selectedSessionId: string | null;
  onToggleEvents: (sessionId: string) => void;
  viewMode: "chat" | "events";
  onViewModeChange: (mode: "chat" | "events") => void;
};

function SessionsCard({
  sessions,
  sessionTitle,
  onSessionTitleChange,
  onCreateSession,
  isCreating,
  onRefresh,
  copiedCommand,
  onCopySessionId,
  port,
  selectedSessionId,
  onToggleEvents,
  viewMode,
  onViewModeChange,
}: SessionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sessions</CardTitle>
          <Button onClick={onRefresh} size="sm" variant="outline">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sessionTitle">Create New Session</Label>
          <div className="flex gap-2">
            <Input
              id="sessionTitle"
              onChange={(e) => onSessionTitleChange(e.target.value)}
              placeholder="Session title (optional)"
              value={sessionTitle}
            />
            <Button disabled={isCreating} onClick={onCreateSession}>
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>

        {sessions && sessions.length > 0 ? (
          <div className="space-y-2">
            <Label>Existing Sessions</Label>
            <div className="space-y-2">
              {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: session rendering requires conditional UI */}
              {sessions.map((session) => (
                <div className="rounded-md border p-3" key={session.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-sm">
                        {session.title || "Untitled Session"}
                      </p>
                      <p className="font-mono text-muted-foreground text-xs">
                        {session.id}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => onCopySessionId(session.id)}
                        size="sm"
                        variant="outline"
                      >
                        {copiedCommand === session.id ? "Copied!" : "Copy ID"}
                      </Button>
                      <Button
                        onClick={() => {
                          if (
                            selectedSessionId === session.id &&
                            viewMode === "chat"
                          ) {
                            onToggleEvents(session.id);
                          } else {
                            onToggleEvents(session.id);
                            onViewModeChange("chat");
                          }
                        }}
                        size="sm"
                        variant={
                          selectedSessionId === session.id &&
                          viewMode === "chat"
                            ? "default"
                            : "outline"
                        }
                      >
                        {selectedSessionId === session.id && viewMode === "chat"
                          ? "Hide Chat"
                          : "View Chat"}
                      </Button>
                      <Button
                        onClick={() => {
                          if (
                            selectedSessionId === session.id &&
                            viewMode === "events"
                          ) {
                            onToggleEvents(session.id);
                          } else {
                            onToggleEvents(session.id);
                            onViewModeChange("events");
                          }
                        }}
                        size="sm"
                        variant={
                          selectedSessionId === session.id &&
                          viewMode === "events"
                            ? "default"
                            : "outline"
                        }
                      >
                        {selectedSessionId === session.id &&
                        viewMode === "events"
                          ? "Hide Events"
                          : "View Events"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-muted p-4">
              <p className="font-medium text-sm">
                How to connect to a session:
              </p>
              <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-sm">
                <li>Copy the session ID using the button above</li>
                <li>
                  Run:{" "}
                  <code className="font-mono">
                    opencode attach http://127.0.0.1:{port}
                  </code>
                </li>
                <li>
                  Press <code className="font-mono">Ctrl+X L</code> to list
                  sessions
                </li>
                <li>Select your session from the list, or paste the ID</li>
              </ol>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No sessions yet. Create one above!
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type ChatMessagesCardProps = {
  messages: ChatMessage[];
  isStreaming: boolean;
  onClear: () => void;
};

function ChatMessagesCard({
  messages,
  isStreaming,
  onClear,
}: ChatMessagesCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Chat Messages</CardTitle>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                <span className="text-muted-foreground text-xs">Streaming</span>
              </div>
            )}
            <Button onClick={onClear} size="sm" variant="outline">
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              {isStreaming ? "Waiting for messages..." : "No messages yet"}
            </p>
          ) : (
            <div className="max-h-96 space-y-4 overflow-y-auto">
              {messages.map((message) => (
                <div
                  className={`rounded-md border p-4 ${
                    message.role === "user"
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                      : "border-green-500 bg-green-50 dark:bg-green-950"
                  }`}
                  key={message.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium text-sm ${
                            message.role === "user"
                              ? "text-blue-700 dark:text-blue-300"
                              : "text-green-700 dark:text-green-300"
                          }`}
                        >
                          {message.role === "user" ? "User" : "Assistant"}
                        </span>
                        {!message.isComplete && (
                          <div className="flex items-center gap-1">
                            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                            <span className="text-muted-foreground text-xs">
                              typing...
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap font-mono text-sm">
                        {message.text}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-muted-foreground text-xs">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type EventStreamCardProps = {
  events: OpencodeEvent[];
  isStreaming: boolean;
  onClear: () => void;
};

function EventStreamCard({
  events,
  isStreaming,
  onClear,
}: EventStreamCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Event Stream</CardTitle>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                <span className="text-muted-foreground text-xs">Streaming</span>
              </div>
            )}
            <Button onClick={onClear} size="sm" variant="outline">
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              {isStreaming ? "Waiting for events..." : "No events received yet"}
            </p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {events.map((event, index) => (
                <div
                  className="rounded-md border bg-muted p-3"
                  key={`${event.timestamp}-${index}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <p className="font-medium font-mono text-sm">
                        {event.type}
                      </p>
                      {event.properties && (
                        <pre className="overflow-x-auto font-mono text-muted-foreground text-xs">
                          {JSON.stringify(event.properties, null, 2)}
                        </pre>
                      )}
                    </div>
                    <span className="whitespace-nowrap text-muted-foreground text-xs">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
