import { createFileRoute } from "@tanstack/react-router";
import { AgentChat } from "@/components/agent-chat";

export const Route = createFileRoute("/constructs/$constructId/chat")({
  component: ConstructChat,
});

function ConstructChat() {
  const { constructId } = Route.useParams();
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-[#1f1f1c] bg-[#050505]">
      <AgentChat constructId={constructId} />
    </div>
  );
}
