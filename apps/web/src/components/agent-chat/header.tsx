import type { AgentSession } from "@/queries/agents";
import { formatStatus, getStatusAppearance } from "./status-theme";

type AgentChatHeaderProps = {
  cellId: string;
  session: AgentSession;
};

export function AgentChatHeader({ cellId, session }: AgentChatHeaderProps) {
  const statusTheme = getStatusAppearance(session.status);

  return (
    <header className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-muted-foreground text-xs">
      <span className="text-[10px] uppercase tracking-[0.25em]">Cell</span>
      <span className="font-semibold text-foreground text-sm tracking-wide">
        {cellId}
      </span>
      <span className="text-muted-foreground">·</span>
      <span>Template · {session.templateId}</span>
      <span className="text-muted-foreground">·</span>
      <span>Provider · {session.provider}</span>
      <span
        className={`ml-auto rounded-full border px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${statusTheme.badge}`}
      >
        {formatStatus(session.status)}
      </span>
    </header>
  );
}
