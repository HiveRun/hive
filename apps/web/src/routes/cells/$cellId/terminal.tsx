import { createFileRoute } from "@tanstack/react-router";
import { CellTerminal } from "@/components/cell-terminal";

export const Route = createFileRoute("/cells/$cellId/terminal")({
  component: CellTerminalRoute,
});

function CellTerminalRoute() {
  const { cellId } = Route.useParams();
  return <CellTerminal cellId={cellId} />;
}
