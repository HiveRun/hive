import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CellTerminal } from "@/components/cell-terminal";
import { cellQueries } from "@/queries/cells";

export const Route = createFileRoute("/cells/$cellId/chat")({
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));

  return (
    <CellTerminal
      cellId={cellId}
      connectCommand={cellQuery.data?.opencodeCommand ?? null}
      endpointBase="chat/terminal"
      reconnectLabel="Reconnect chat"
      restartLabel="Restart chat"
      title="Cell Chat"
    />
  );
}
