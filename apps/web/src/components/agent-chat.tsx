import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentPermissions } from "@/components/agent-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAgentEventStream } from "@/hooks/use-agent-event-stream";
import {
  type AgentMessage,
  agentMutations,
  agentQueries,
} from "@/queries/agents";

type AgentChatProps = {
  constructId: string;
};

export function AgentChat({ constructId }: AgentChatProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(agentQueries.sessionByConstruct(constructId));
  const session = sessionQuery.data ?? null;
  const messagesQuery = useQuery(agentQueries.messages(session?.id ?? null));
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { permissions } = useAgentEventStream(session?.id ?? null, constructId);

  const orderedMessages = useMemo(
    () =>
      (messagesQuery.data ?? [])
        .slice()
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
    [messagesQuery.data]
  );

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) {
      return orderedMessages;
    }
    const query = searchQuery.trim().toLowerCase();
    return orderedMessages.filter((msg) =>
      (msg.content ?? "").toLowerCase().includes(query)
    );
  }, [orderedMessages, searchQuery]);

  const totalMessages = orderedMessages.length;

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

  const statusTheme = getStatusAppearance(session?.status);

  if (sessionQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center border-2 border-[#1f1f1c] bg-[#080908] text-[#b1b3ab] text-sm">
        Loading agent session...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full flex-col justify-center gap-4 border-2 border-[#1f1f1c] bg-[#080908] px-4 py-6 text-[#f2f2ed]">
        <div>
          <p className="text-[#8e9088] text-xs uppercase tracking-[0.3em]">
            Agent Session
          </p>
          <p className="text-[#b1b3ab] text-sm">
            No agent is currently running for this construct. Start a session to
            chat with the workspace agent.
          </p>
        </div>
        <Button
          className="self-start border-2 border-[#4a5d4a] bg-transparent px-4 text-[#f2f2ed] hover:bg-[#1d211d]"
          disabled={isStarting}
          onClick={handleStartSession}
          type="button"
        >
          {isStarting ? "Starting..." : "Start Agent Session"}
        </Button>
      </div>
    );
  }

  const renderConversation = () => {
    if (messagesQuery.isPending) {
      return (
        <p className="text-muted-foreground text-sm">Loading conversation...</p>
      );
    }

    if (totalMessages === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          No messages yet. Say hello to get started.
        </p>
      );
    }

    if (filteredMessages.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          No messages matched “{searchQuery}”.
        </p>
      );
    }

    return filteredMessages.map((chatMessage) => (
      <MessageBubble key={chatMessage.id} message={chatMessage} />
    ));
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-2 border-[#1f1f1c] bg-[#080908] text-[#f2f2ed]">
      <header className="flex items-center gap-2 border-[#2a2a26] border-b-2 px-3 py-1.5 text-[#a3a59e] text-xs">
        <span className="text-[#8e9088] text-[10px] uppercase tracking-[0.25em]">
          Construct
        </span>
        <span className="font-semibold text-[#f8f8f3] text-sm tracking-wide">
          {constructId}
        </span>
        <span className="text-[#6b7280]">·</span>
        <span>Template · {session.templateId}</span>
        <span className="text-[#6b7280]">·</span>
        <span>Provider · {session.provider}</span>
        <span
          className={`ml-auto rounded-full border-2 px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${statusTheme.badge}`}
        >
          {formatStatus(session.status)}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col border-[#2a2a26] border-b-2 p-2 lg:border-r-2 lg:border-b-0">
          <div className="flex flex-wrap items-center gap-2 text-[#8e9088] text-[10px] uppercase tracking-[0.2em]">
            <span>
              {totalMessages} message{totalMessages === 1 ? "" : "s"}
            </span>
            <span className="text-[#4a5d4a]">•</span>
            <span>Workspace · {session.workspacePath}</span>
            <span className="text-[#4a5d4a]">•</span>
            <span>Provider · {session.provider}</span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5 md:flex-row md:items-center">
            <Input
              className="h-8 border-2 border-[#2d302b] bg-transparent text-[#f8f8f3] text-sm placeholder:text-[#8e9088] focus-visible:ring-[#4a5d4a]"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search conversation"
              value={searchQuery}
            />
            <span className="whitespace-nowrap text-[#8e9088] text-[10px] uppercase tracking-[0.25em]">
              Conversation Log
            </span>
          </div>
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {renderConversation()}
          </div>
          {session?.id && (
            <div className="mt-2">
              <AgentPermissions
                permissions={permissions}
                sessionId={session.id}
              />
            </div>
          )}
        </section>
        <section className="min-h-0 w-full overflow-y-auto border-[#2a2a26] border-t-2 bg-[#0a0b0a] p-3 lg:w-80 lg:border-t-0 lg:border-l-2">
          <div className="flex items-center justify-between text-[#8e9088] text-[10px] uppercase tracking-[0.25em]">
            <span>Send Instructions</span>
            <span>{session.provider}</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <Label
              className="text-[#8e9088] text-[10px] uppercase tracking-[0.2em]"
              htmlFor="agent-message"
            >
              Message
            </Label>
            <Textarea
              className="min-h-[140px] border-2 border-[#32342f] bg-transparent text-[#f8f8f3] text-sm placeholder:text-[#8e9088] focus-visible:ring-[#4a5d4a]"
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
              placeholder="Describe the work you want completed"
              value={message}
            />
            <div className="flex items-center justify-between text-[#8e9088] text-[10px] uppercase tracking-[0.2em]">
              <span>Ctrl+Enter to send</span>
              <Button
                className="border-2 border-[#4a5d4a] bg-[#1d211d] px-3 py-1 text-[#f8f8f3] text-xs hover:bg-[#252b25] focus-visible:ring-[#4a5d4a]"
                disabled={isSending || !message.trim()}
                onClick={handleSendMessage}
                type="button"
              >
                {isSending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const LEADING_WHITESPACE = /^\s+/;

const STATUS_APPEARANCES: Record<string, { badge: string }> = {
  working: {
    badge: "border-[#5a7c5a] bg-[#102414] text-[#d8f1d8]",
  },
  starting: {
    badge: "border-[#6b7280] bg-[#121315] text-[#d5d7dd]",
  },
  awaiting_input: {
    badge: "border-[#8b9d8b] bg-[#111812] text-[#f0f4f0]",
  },
  completed: {
    badge: "border-[#4a5d4a] bg-[#0f1710] text-[#cfe3cf]",
  },
  idle: {
    badge: "border-[#4a5d4a] bg-[#111512] text-[#d5ead5]",
  },
  error: {
    badge: "border-[#7a2f2f] bg-[#1d0d0d] text-[#f5c8c8]",
  },
  default: {
    badge: "border-[#4a5d4a] bg-[#111512] text-[#d5ead5]",
  },
};

function getStatusAppearance(status?: string) {
  if (!status) {
    return STATUS_APPEARANCES.default;
  }
  return STATUS_APPEARANCES[status] ?? STATUS_APPEARANCES.default;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").toUpperCase();
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

  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.state === "streaming";
  const hasContent = Boolean(message.content?.trim().length);

  let displayContent = "";
  if (hasContent) {
    const rawContent = message.content ?? "";
    displayContent = rawContent.replace(LEADING_WHITESPACE, "");
  }

  const cardTheme = isAssistant
    ? {
        container: "border-2 border-[#3b5c3f] bg-[#0f1f12] text-[#e8f6e8]",
        label: "text-[#9fc7a1]",
        content: "text-[#e8f6e8]",
        placeholder: "text-[#9fc7a1]",
      }
    : {
        container: "border-2 border-[#2c2c2c] bg-[#0f0f0f] text-[#f1f5f1]",
        label: "text-[#9ca3af]",
        content: "text-[#f1f5f1]",
        placeholder: "text-[#9ca3af]",
      };
  const labelText = isAssistant ? "Assistant" : "You";

  return (
    <div
      className={`border px-2 py-1.5 text-sm transition-colors ${cardTheme.container}`}
    >
      <div
        className={`flex items-center justify-between text-[10px] uppercase tracking-[0.2em] ${cardTheme.label}`}
      >
        <span>{labelText}</span>
        <span>{createdAt}</span>
      </div>
      <div className="mt-1 leading-relaxed">
        {hasContent ? (
          <p className={`whitespace-pre-wrap ${cardTheme.content}`}>
            {displayContent}
          </p>
        ) : (
          <p
            className={
              isStreaming
                ? `animate-pulse ${cardTheme.placeholder}`
                : `${cardTheme.placeholder} italic`
            }
            style={{ minHeight: "1.2rem" }}
          >
            {isStreaming ? "Agent is responding…" : "No text content"}
          </p>
        )}
      </div>
    </div>
  );
}
