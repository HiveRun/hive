import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentPermissions } from "@/components/agent-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const { permissions } = useAgentEventStream(session?.id ?? null, constructId);

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
        {session?.id && (
          <AgentPermissions permissions={permissions} sessionId={session.id} />
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
