import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ModelSelection } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { useAgentEventStream } from "@/hooks/use-agent-event-stream";
import { agentMutations, agentQueries } from "@/queries/agents";
import { cellQueries } from "@/queries/cells";
import { ComposePanel } from "./compose-panel";
import { ConversationPanel } from "./conversation-panel";
import { AgentChatHeader } from "./header";

type AgentChatProps = {
  cellId: string;
};

export function AgentChat({ cellId }: AgentChatProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(agentQueries.sessionByCell(cellId));
  const session = sessionQuery.data ?? null;
  const sessionId = session?.id;
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const workspaceId = cellQuery.data?.workspaceId;
  const messagesQuery = useQuery(agentQueries.messages(sessionId ?? null));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelSelection>();

  const { permissions } = useAgentEventStream(sessionId ?? null, cellId);

  useEffect(() => {
    if (!session?.modelId) {
      setSelectedModel(undefined);
      return;
    }
    const providerId = session.modelProviderId ?? session.provider;
    setSelectedModel({ id: session.modelId, providerId });
  }, [session]);

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
        agentQueries.sessionByCell(cellId).queryKey,
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
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      toast.error(errorMessage);
    },
  });

  const setModelMutation = useMutation({
    ...agentMutations.setModel,
    onSuccess: (updatedSession) => {
      queryClient.setQueryData(
        agentQueries.sessionByCell(cellId).queryKey,
        updatedSession
      );
      setSelectedModel(
        updatedSession.modelId
          ? {
              id: updatedSession.modelId,
              providerId:
                updatedSession.modelProviderId ?? updatedSession.provider,
            }
          : undefined
      );
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update model";
      toast.error(errorMessage);
      setSelectedModel(
        session?.modelId
          ? {
              id: session.modelId,
              providerId: session.modelProviderId ?? session.provider,
            }
          : undefined
      );
    },
  });

  const handleStartSession = () => {
    startAgentMutation.mutate({
      cellId,
      modelId: selectedModel?.id,
      providerId: selectedModel?.providerId,
    });
  };

  const handleSendMessage = async (content: string) => {
    if (!(session?.id && content.trim())) {
      return;
    }
    await sendMessageMutation.mutateAsync({
      sessionId: session.id,
      content: content.trim(),
    });
  };

  const handleModelChange = useCallback(
    (model: ModelSelection) => {
      setSelectedModel(model);
      if (session?.id) {
        setModelMutation.mutate({
          sessionId: session.id,
          modelId: model.id,
          providerId: model.providerId,
        });
      }
    },
    [session?.id, setModelMutation]
  );

  const isStarting = startAgentMutation.isPending;
  const isSending = sendMessageMutation.isPending;

  if (sessionQuery.isPending || cellQuery.isPending) {
    return <LoadingState />;
  }

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center border-2 border-border bg-card text-muted-foreground text-sm">
        Unable to determine active workspace for this cell.
      </div>
    );
  }

  if (!session) {
    return (
      <NoSessionState isStarting={isStarting} onStart={handleStartSession} />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-2 border-border bg-background text-foreground">
      <AgentChatHeader cellId={cellId} session={session} />
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
          isModelChanging={setModelMutation.isPending}
          isSending={isSending}
          onModelChange={handleModelChange}
          onSend={handleSendMessage}
          provider={session.provider}
          selectedModel={selectedModel}
          sessionId={session.id}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center border-2 border-border bg-card text-muted-foreground text-sm">
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
    <div className="flex h-full flex-col justify-center gap-4 border-2 border-border bg-card px-4 py-6 text-foreground">
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
          Agent Session
        </p>
        <p className="text-muted-foreground text-sm">
          No agent is currently running for this cell. Start a session to chat
          with the workspace agent.
        </p>
      </div>
      <Button
        className="self-start border border-primary bg-primary px-4 text-primary-foreground hover:bg-primary/90"
        disabled={isStarting}
        onClick={onStart}
        type="button"
      >
        {isStarting ? "Starting..." : "Start Agent Session"}
      </Button>
    </div>
  );
}
