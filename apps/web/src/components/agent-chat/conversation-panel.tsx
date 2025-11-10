import { useMemo } from "react";
import { AgentPermissions } from "@/components/agent-permissions";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PermissionRequest } from "@/hooks/use-agent-event-stream";
import type { AgentMessage } from "@/queries/agents";
import { MessageBubble } from "./message-bubble";

type ConversationPanelProps = {
  totalMessages: number;
  filteredMessages: AgentMessage[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  workspacePath: string;
  provider: string;
  permissions: PermissionRequest[];
  sessionId: string;
  isLoading: boolean;
};

export function ConversationPanel({
  totalMessages,
  filteredMessages,
  searchQuery,
  onSearchQueryChange,
  workspacePath,
  provider,
  permissions,
  sessionId,
  isLoading,
}: ConversationPanelProps) {
  const hasMessages = totalMessages > 0;
  const hasFilteredResults = filteredMessages.length > 0;

  const conversationContent = useMemo(() => {
    if (isLoading) {
      return (
        <p className="text-[var(--chat-neutral-500)] text-sm">
          Loading conversation...
        </p>
      );
    }

    if (!hasMessages) {
      return (
        <p className="text-[var(--chat-neutral-500)] text-sm">
          No messages yet. Say hello to get started.
        </p>
      );
    }

    if (!hasFilteredResults) {
      return (
        <p className="text-[var(--chat-neutral-500)] text-sm">
          No messages matched “{searchQuery}”.
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {filteredMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    );
  }, [
    filteredMessages,
    hasFilteredResults,
    hasMessages,
    isLoading,
    searchQuery,
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-[var(--chat-divider)] border-b-2 p-2 lg:border-r-2 lg:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        <span>
          {totalMessages} message{totalMessages === 1 ? "" : "s"}
        </span>
        <span className="text-[var(--chat-accent)]">•</span>
        <span>Workspace · {workspacePath}</span>
        <span className="text-[var(--chat-accent)]">•</span>
        <span>Provider · {provider}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5 md:flex-row md:items-center">
        <Input
          className="h-8 border-2 border-[var(--chat-input-border)] bg-transparent text-[var(--chat-neutral-50)] text-sm placeholder:text-[var(--chat-neutral-450)] focus-visible:ring-[var(--chat-accent)]"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search conversation"
          value={searchQuery}
        />
        <span className="whitespace-nowrap text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
          Conversation Log
        </span>
      </div>
      <ScrollArea className="mt-2 min-h-0 flex-1 pr-1">
        {conversationContent}
      </ScrollArea>
      {permissions.length > 0 ? (
        <div className="mt-2">
          <AgentPermissions permissions={permissions} sessionId={sessionId} />
        </div>
      ) : null}
    </section>
  );
}
