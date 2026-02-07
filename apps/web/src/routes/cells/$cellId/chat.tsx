import { createFileRoute } from "@tanstack/react-router";
import { CellTerminal } from "@/components/cell-terminal";

export const Route = createFileRoute("/cells/$cellId/chat")({
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  return (
    <CellTerminal
      cellId={cellId}
      endpointBase="chat/terminal"
      reconnectLabel="Reconnect chat"
      restartLabel="Restart chat"
      title="Cell Chat"
    />
  );
}
