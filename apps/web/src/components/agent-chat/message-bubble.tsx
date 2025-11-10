import { useMemo } from "react";
import type { AgentMessage } from "@/queries/agents";

const LEADING_WHITESPACE = /^\s+/;

const ASSISTANT_THEME = {
  container:
    "border-2 border-[var(--chat-assistant-border)] bg-[var(--chat-assistant-bg)] text-[var(--chat-assistant-text)]",
  label: "text-[var(--chat-assistant-label)]",
  content: "text-[var(--chat-assistant-text)]",
  placeholder: "text-[var(--chat-assistant-label)]",
};

const USER_THEME = {
  container:
    "border-2 border-[var(--chat-user-border)] bg-[var(--chat-user-bg)] text-[var(--chat-user-text)]",
  label: "text-[var(--chat-user-label)]",
  content: "text-[var(--chat-user-text)]",
  placeholder: "text-[var(--chat-user-label)]",
};

export function MessageBubble({ message }: { message: AgentMessage }) {
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

  const theme = isAssistant ? ASSISTANT_THEME : USER_THEME;
  const labelText = isAssistant ? "Agent" : "You";

  return (
    <div className={`px-2 py-1.5 text-sm transition-colors ${theme.container}`}>
      <div
        className={`flex items-center justify-between text-[10px] uppercase tracking-[0.2em] ${theme.label}`}
      >
        <span>{labelText}</span>
        <span>{createdAt}</span>
      </div>
      <div className="mt-1 leading-relaxed">
        {hasContent ? (
          <p className={`whitespace-pre-wrap ${theme.content}`}>
            {displayContent}
          </p>
        ) : (
          <p
            className={
              isStreaming
                ? `animate-pulse ${theme.placeholder}`
                : `${theme.placeholder} italic`
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
