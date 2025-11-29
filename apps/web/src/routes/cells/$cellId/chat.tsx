import { createFileRoute } from "@tanstack/react-router";
import { AgentChat } from "@/components/agent-chat";

export const Route = createFileRoute("/cells/$cellId/chat")({
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <AgentChat cellId={cellId} />
    </div>
  );
}
