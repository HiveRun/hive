import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CellTerminal } from "@/components/cell-terminal";
import { useTheme } from "@/components/theme-provider";
import { cellQueries } from "@/queries/cells";

export const Route = createFileRoute("/cells/$cellId/chat")({
  loader: async ({ params, context: { queryClient } }) => {
    const cell = await queryClient.ensureQueryData(
      cellQueries.detail(params.cellId)
    );
    if (cell.status !== "ready") {
      throw redirect({
        to: "/cells/$cellId/provisioning",
        params,
        replace: true,
      });
    }
  },
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));
  const { theme } = useTheme();
  const themeMode =
    theme === "light" ||
    (theme === "system" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light"))
      ? "light"
      : "dark";

  const startupStatusMessage = "Starting OpenCode session";

  return (
    <CellTerminal
      cellId={cellId}
      connectCommand={cellQuery.data?.opencodeCommand ?? null}
      endpointBase="chat/terminal"
      reconnectLabel="Reconnect chat"
      restartLabel="Restart chat"
      startupReadiness="terminal-content"
      startupStatusMessage={startupStatusMessage}
      startupTextMatch={cellQuery.data?.name ?? null}
      terminalLineHeight={1}
      themeMode={themeMode}
      title="Cell Chat"
    />
  );
}
