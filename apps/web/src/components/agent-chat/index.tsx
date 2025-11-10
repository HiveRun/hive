import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAgentEventStream } from "@/hooks/use-agent-event-stream";
import { agentMutations, agentQueries } from "@/queries/agents";
import { ComposePanel } from "./compose-panel";
import { ConversationPanel } from "./conversation-panel";
import { AgentChatHeader } from "./header";

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

  if (sessionQuery.isPending) {
    return <LoadingState />;
  }

  if (!session) {
    return (
      <NoSessionState isStarting={isStarting} onStart={handleStartSession} />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-2 border-[var(--chat-border)] bg-[var(--chat-surface)] text-[var(--chat-neutral-100)]">
      <AgentChatHeader constructId={constructId} session={session} />
      <div className="flex flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
        <ConversationPanel
          filteredMessages={filteredMessages}
          isLoading={messagesQuery.isPending}
          onSearchQueryChange={setSearchQuery}
          permissions={permissions}
          provider={session.provider}
          searchQuery={searchQuery}
          sessionId={session.id}
          totalMessages={totalMessages}
          workspacePath={session.workspacePath}
        />
        <ComposePanel
          isSending={isSending}
          message={message}
          onMessageChange={setMessage}
          onSend={handleSendMessage}
          provider={session.provider}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center border-2 border-[var(--chat-border)] bg-[var(--chat-surface)] text-[var(--chat-neutral-300)] text-sm">
      Loading agent session...
    </div>
  );
}

function NoSessionState({
  isStarting,
  onStart,
}: {
  isStarting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-4 border-2 border-[var(--chat-border)] bg-[var(--chat-surface)] px-4 py-6 text-[var(--chat-neutral-100)]">
      <div>
        <p className="text-[var(--chat-neutral-450)] text-xs uppercase tracking-[0.3em]">
          Agent Session
        </p>
        <p className="text-[var(--chat-neutral-300)] text-sm">
          No agent is currently running for this construct. Start a session to
          chat with the workspace agent.
        </p>
      </div>
      <Button
        className="self-start border-2 border-[var(--chat-accent)] bg-transparent px-4 text-[var(--chat-neutral-50)] hover:bg-[var(--chat-accent-dark)]"
        disabled={isStarting}
        onClick={onStart}
        type="button"
      >
        {isStarting ? "Starting..." : "Start Agent Session"}
      </Button>
    </div>
  );
}
