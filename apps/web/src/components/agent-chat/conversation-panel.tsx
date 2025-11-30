import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentPermissions } from "@/components/agent-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PermissionRequest } from "@/hooks/use-agent-event-stream";
import type { AgentMessage } from "@/queries/agents";

import { MessageBubble } from "./message-bubble";

type ConversationMessage = AgentMessage & {
  interruptionReason?: string;
};

type ConversationPanelProps = {
  totalMessages: number;
  filteredMessages: ConversationMessage[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;

  workspacePath: string;
  provider: string;
  permissions: PermissionRequest[];
  sessionId: string;
  isLoading: boolean;
};

const SCROLL_STORAGE_PREFIX = "agent-chat-scroll";
const SCROLL_BOTTOM_THRESHOLD = 16;

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

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(filteredMessages.length);
  const pendingRestoreRef = useRef(true);
  const skipAutoScrollRef = useRef(false);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const scrollStorageKey = useMemo(
    () => `${SCROLL_STORAGE_PREFIX}:${sessionId}`,
    [sessionId]
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    pendingRestoreRef.current = true;
  }, [sessionId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const updateScrollMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const atBottom =
      scrollHeight - (scrollTop + clientHeight) < SCROLL_BOTTOM_THRESHOLD;
    setIsAtBottom(atBottom);
    setIsOverflowing(scrollHeight - clientHeight > 1);

    if (!pendingRestoreRef.current && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(
          scrollStorageKey,
          JSON.stringify({ top: scrollTop })
        );
      } catch {
        // Ignore storage failures
      }
    }
  }, [scrollStorageKey]);

  const restoreScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (typeof window === "undefined") {
      pendingRestoreRef.current = false;
      return;
    }

    try {
      const stored = window.localStorage.getItem(scrollStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { top?: number };
        if (typeof parsed.top === "number") {
          viewport.scrollTo({ top: parsed.top, behavior: "auto" });
        } else {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
        }
      } else {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
      }
    } catch {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    }

    pendingRestoreRef.current = false;
    skipAutoScrollRef.current = true;
    updateScrollMetrics();
  }, [scrollStorageKey, updateScrollMetrics]);

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) {
      return;
    }
    const viewport = root.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) {
      return;
    }

    viewportRef.current = viewport;

    const handleScroll = () => updateScrollMetrics();
    viewport.addEventListener("scroll", handleScroll);

    requestAnimationFrame(() => {
      updateScrollMetrics();
    });

    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [updateScrollMetrics]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateScrollMetrics());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [updateScrollMetrics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => updateScrollMetrics();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateScrollMetrics]);

  useEffect(() => {
    if (!pendingRestoreRef.current) {
      return;
    }
    if (isLoading) {
      return;
    }
    // Ensure content has rendered before restoring
    if (filteredMessages.length === 0) {
      updateScrollMetrics();
      return;
    }
    restoreScrollPosition();
  }, [
    filteredMessages.length,
    isLoading,
    restoreScrollPosition,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const previousCount = prevMessageCountRef.current;
    prevMessageCountRef.current = filteredMessages.length;

    if (pendingRestoreRef.current) {
      return;
    }

    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      requestAnimationFrame(updateScrollMetrics);
      return;
    }

    if (filteredMessages.length > previousCount && isAtBottom) {
      scrollToBottom("auto");
    } else {
      requestAnimationFrame(updateScrollMetrics);
    }
  }, [
    filteredMessages.length,
    isAtBottom,
    scrollToBottom,
    updateScrollMetrics,
  ]);

  const conversationContent = useMemo(() => {
    if (isLoading) {
      return (
        <p className="text-muted-foreground text-sm">Loading conversation...</p>
      );
    }

    if (!hasMessages) {
      return (
        <p className="text-muted-foreground text-sm">
          No messages yet. Say hello to get started.
        </p>
      );
    }

    if (!hasFilteredResults) {
      return (
        <p className="text-muted-foreground text-sm">
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

  const showScrollToLatest = !isAtBottom && isOverflowing;

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-border/60 bg-card p-2 lg:border-r-2 lg:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        <span>
          {totalMessages} message{totalMessages === 1 ? "" : "s"}
        </span>
        <span className="text-primary">•</span>
        <span>Workspace · {workspacePath}</span>
        <span className="text-primary">•</span>
        <span>Provider · {provider}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5 md:flex-row md:items-center">
        <Input
          className="h-8 border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus-visible:ring-primary"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search conversation"
          value={searchQuery}
        />
        <span className="whitespace-nowrap text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
          Conversation Log
        </span>
      </div>
      <div className="relative mt-2 flex min-h-0 flex-1">
        <ScrollArea
          className="flex h-full min-h-0 flex-1 pr-1"
          ref={scrollAreaRef}
        >
          {conversationContent}
        </ScrollArea>
        {showScrollToLatest ? (
          <Button
            aria-label="Jump to latest message"
            className="absolute right-3 bottom-3 h-9 w-9 rounded-full border border-border bg-background/90 text-foreground shadow-lg backdrop-blur"
            onClick={() => scrollToBottom()}
            size="icon"
            type="button"
            variant="secondary"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {permissions.length > 0 ? (
        <div className="mt-2">
          <AgentPermissions permissions={permissions} sessionId={sessionId} />
        </div>
      ) : null}
    </section>
  );
}
