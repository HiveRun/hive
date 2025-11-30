import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ModelSelection } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { useAgentEventStream } from "@/hooks/use-agent-event-stream";
import type { AgentMessage } from "@/queries/agents";
import { agentMutations, agentQueries } from "@/queries/agents";
import { cellQueries } from "@/queries/cells";
import { ComposePanel } from "./compose-panel";
import { ConversationPanel } from "./conversation-panel";
import { AgentChatHeader } from "./header";

const INTERRUPT_CONFIRM_WINDOW_MS = 5000;
const INTERRUPT_FALLBACK_REASON = "THE OPERATION WAS ABORTED.";

type DisplayAgentMessage = AgentMessage & {
  interruptionReason?: string;
};

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
  const [pendingInterruptConfirm, setPendingInterruptConfirm] = useState(false);
  const interruptConfirmTimerRef = useRef<number | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);

  const { permissions } = useAgentEventStream(sessionId ?? null, cellId);

  useEffect(() => {
    if (!session?.modelId) {
      setSelectedModel(undefined);
      return;
    }
    const providerId = session.modelProviderId ?? session.provider;
    setSelectedModel({ id: session.modelId, providerId });
  }, [session]);

  const orderedMessages = useMemo<DisplayAgentMessage[]>(() => {
    const base = (messagesQuery.data ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    const interruptedReasons = new Map<string, string>();
    const processed: DisplayAgentMessage[] = [];

    for (const message of base) {
      if (isAbortedAssistantMessage(message)) {
        const reason = message.errorMessage ?? INTERRUPT_FALLBACK_REASON;
        const targetId =
          message.parentId ?? findPreviousUserMessageId(processed);
        if (targetId) {
          interruptedReasons.set(targetId, reason);
        }
        continue;
      }
      processed.push(message);
    }

    return processed.map((message) => {
      if (message.role !== "user") {
        return message;
      }
      const reason = interruptedReasons.get(message.id);
      return reason ? { ...message, interruptionReason: reason } : message;
    });
  }, [messagesQuery.data]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) {
      return orderedMessages;
    }
    const query = searchQuery.trim().toLowerCase();
    return orderedMessages.filter((msg) =>
      `${msg.content ?? ""} ${msg.interruptionReason ?? ""} ${msg.errorMessage ?? ""}`
        .toLowerCase()
        .includes(query)
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

  const interruptAgentMutation = useMutation({
    ...agentMutations.interrupt,
    onError: (error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to interrupt agent session";
      toast.error(errorMessage);
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

  const clearInterruptConfirm = useCallback(() => {
    setPendingInterruptConfirm(false);
    if (interruptConfirmTimerRef.current !== null) {
      if (typeof window !== "undefined") {
        window.clearTimeout(interruptConfirmTimerRef.current);
      } else {
        clearTimeout(interruptConfirmTimerRef.current);
      }
      interruptConfirmTimerRef.current = null;
    }
  }, []);

  const handleInterrupt = useCallback(() => {
    if (!session?.id) {
      return;
    }
    clearInterruptConfirm();
    interruptAgentMutation.mutate({ sessionId: session.id });
  }, [session?.id, clearInterruptConfirm, interruptAgentMutation]);

  const isStarting = startAgentMutation.isPending;
  const isSending = sendMessageMutation.isPending;
  const isInterrupting = interruptAgentMutation.isPending;
  const isInterruptible = Boolean(
    session && (isSending || session.status === "working")
  );
  const canInterrupt = isInterruptible && !isInterrupting;
  const showEscInterruptHint = pendingInterruptConfirm && canInterrupt;

  useEffect(() => () => clearInterruptConfirm(), [clearInterruptConfirm]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!canInterrupt) {
      clearInterruptConfirm();
      return;
    }

    const shouldHandleInterruptKey = (event: KeyboardEvent): boolean => {
      if (event.key !== "Escape") {
        return false;
      }
      const root = chatRootRef.current;
      const targetNode = event.target as Node | null;
      if (!(root && targetNode && root.contains(targetNode))) {
        return false;
      }
      if (event.defaultPrevented) {
        return false;
      }
      return true;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleInterruptKey(event)) {
        return;
      }

      event.preventDefault();

      if (!pendingInterruptConfirm) {
        setPendingInterruptConfirm(true);
        if (interruptConfirmTimerRef.current) {
          clearTimeout(interruptConfirmTimerRef.current);
        }
        interruptConfirmTimerRef.current = window.setTimeout(() => {
          setPendingInterruptConfirm(false);
          interruptConfirmTimerRef.current = null;
        }, INTERRUPT_CONFIRM_WINDOW_MS);
        return;
      }

      clearInterruptConfirm();
      handleInterrupt();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canInterrupt,
    clearInterruptConfirm,
    handleInterrupt,
    pendingInterruptConfirm,
  ]);

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
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-2 border-border bg-background text-foreground"
      ref={chatRootRef}
    >
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
          canInterrupt={canInterrupt}
          isInterrupting={isInterrupting}
          isModelChanging={setModelMutation.isPending}
          isSending={isSending}
          onInterrupt={handleInterrupt}
          onModelChange={handleModelChange}
          onSend={handleSendMessage}
          provider={session.provider}
          selectedModel={selectedModel}
          sessionId={session.id}
          showInterruptHint={showEscInterruptHint}
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

function isAbortedAssistantMessage(message: AgentMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.errorName !== "MessageAbortedError") {
    return false;
  }
  const hasContent = Boolean(message.content?.trim().length);
  return !hasContent;
}

function findPreviousUserMessageId(
  messages: DisplayAgentMessage[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }
    if (candidate.role === "user") {
      return candidate.id;
    }
  }
  return;
}
