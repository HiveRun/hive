import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/queries/agents";

const LEADING_WHITESPACE = /^\s+/;

const ASSISTANT_THEME = {
  container: "border border-primary/40 bg-primary/10 text-foreground",
  label: "text-xs font-semibold uppercase tracking-[0.2em] text-primary",
  content: "text-foreground",
  placeholder: "text-muted-foreground",
};

const USER_THEME = {
  container: "border border-border bg-muted text-foreground",
  label:
    "text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground",
  content: "text-foreground",
  placeholder: "text-muted-foreground",
};

type ChatMessage = AgentMessage & {
  interruptionReason?: string | null;
};

export function MessageBubble({ message }: { message: ChatMessage }) {
  const createdAt = formatTimestamp(message.createdAt);
  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.state === "streaming";
  const trimmedContent = trimMessageContent(message.content ?? null);
  const hasContent = trimmedContent.length > 0;
  const isInterrupted =
    message.role === "user" && Boolean(message.interruptionReason);
  const interruptionStyles = getInterruptionStyles(isInterrupted);

  const theme = isAssistant ? ASSISTANT_THEME : USER_THEME;
  const labelText = isAssistant ? "Agent" : "You";
  const containerClass = cn(
    "px-2 py-1.5 text-sm transition-colors",
    theme.container,
    interruptionStyles?.container
  );
  const labelClass = cn(
    "flex items-center justify-between text-[10px] uppercase tracking-[0.2em]",
    theme.label,
    interruptionStyles?.label
  );
  const placeholderText = isStreaming
    ? "Agent is responding…"
    : (message.errorMessage ?? "No text content");
  const placeholderClass = cn(
    isStreaming
      ? `animate-pulse ${theme.placeholder}`
      : `${theme.placeholder} italic`,
    !isStreaming && message.errorMessage && "text-destructive not-italic"
  );
  const interruptionText = message.interruptionReason
    ? message.interruptionReason.toUpperCase()
    : null;

  return (
    <div className={containerClass}>
      <div className={labelClass}>
        <span>{labelText}</span>
        <div className="flex items-center gap-2">
          {interruptionStyles ? (
            <span className={interruptionStyles.badge}>Interrupted</span>
          ) : null}
          <span>{createdAt}</span>
        </div>
      </div>
      <div className="mt-1 leading-relaxed">
        {hasContent ? (
          <p className={`whitespace-pre-wrap ${theme.content}`}>
            {trimmedContent}
          </p>
        ) : (
          <p className={placeholderClass} style={{ minHeight: "1.2rem" }}>
            {placeholderText}
          </p>
        )}
      </div>
      {interruptionStyles ? (
        <p className={interruptionStyles.reason}>
          {interruptionText ?? message.interruptionReason}
        </p>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function trimMessageContent(content: string | null): string {
  if (!content) {
    return "";
  }
  return content.replace(LEADING_WHITESPACE, "");
}

function getInterruptionStyles(isInterrupted: boolean) {
  if (!isInterrupted) {
    return null;
  }
  return {
    container:
      "border-destructive/80 border-dashed bg-destructive/10 text-destructive",
    label: "text-destructive",
    badge:
      "rounded border border-destructive bg-destructive/20 px-2 py-0.5 font-semibold text-[9px] text-destructive uppercase tracking-[0.3em]",
    reason: "mt-2 text-[11px] text-destructive uppercase tracking-[0.3em]",
  } as const;
}
