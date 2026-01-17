import type { CompactionStats } from "@/hooks/use-agent-event-stream";

type AgentChatHeaderProps = {
  compaction: CompactionStats;
  compactionWarning: boolean;
};

export function AgentChatHeader({
  compaction,
  compactionWarning,
}: AgentChatHeaderProps) {
  const compactionStyle = compactionWarning
    ? "border-amber-500 bg-amber-500/15 text-amber-100"
    : "border-border text-foreground";

  return (
    <header className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-muted-foreground text-xs">
      <span
        className={`flex items-center gap-2 rounded-full border px-3 py-0.5 text-[10px] uppercase tracking-[0.25em] ${compactionStyle}`}
      >
        COMPACTIONS {compaction.count}
      </span>
    </header>
  );
}
