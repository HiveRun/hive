import type { CompactionStats } from "@/hooks/use-agent-event-stream";
import type { AgentSession } from "@/queries/agents";
import { formatStatus, getStatusAppearance } from "./status-theme";

type AgentChatHeaderProps = {
  cellId: string;
  session: AgentSession;
  compaction: CompactionStats;
  compactionWarning: boolean;
};

export function AgentChatHeader({
  cellId,
  session,
  compaction,
  compactionWarning,
}: AgentChatHeaderProps) {
  const { badge } = getStatusAppearance(session.status);
  const compactionStyle = compactionWarning
    ? "border-amber-500 bg-amber-500/15 text-amber-100"
    : "border-border text-foreground";

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
      <span className="text-muted-foreground">·</span>
      <span
        className={`flex items-center gap-2 rounded-full border px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${compactionStyle}`}
      >
        Compactions · {compaction.count}
      </span>
      <span
        className={`ml-auto rounded-full border px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${badge}`}
      >
        {formatStatus(session.status)}
      </span>
    </header>
  );
}
