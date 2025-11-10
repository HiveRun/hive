import type { AgentSession } from "@/queries/agents";
import { formatStatus, getStatusAppearance } from "./status-theme";

type AgentChatHeaderProps = {
  constructId: string;
  session: AgentSession;
};

export function AgentChatHeader({
  constructId,
  session,
}: AgentChatHeaderProps) {
  const statusTheme = getStatusAppearance(session.status);

  return (
    <header className="flex items-center gap-2 border-[var(--chat-divider)] border-b-2 px-3 py-1.5 text-[var(--chat-neutral-400)] text-xs">
      <span className="text-[10px] text-[var(--chat-neutral-450)] uppercase tracking-[0.25em]">
        Construct
      </span>
      <span className="font-semibold text-[var(--chat-neutral-50)] text-sm tracking-wide">
        {constructId}
      </span>
      <span className="text-[var(--chat-neutral-500)]">·</span>
      <span>Template · {session.templateId}</span>
      <span className="text-[var(--chat-neutral-500)]">·</span>
      <span>Provider · {session.provider}</span>
      <span
        className={`ml-auto rounded-full border-2 px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${statusTheme.badge}`}
      >
        {formatStatus(session.status)}
      </span>
    </header>
  );
}
