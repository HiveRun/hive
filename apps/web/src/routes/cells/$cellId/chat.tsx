import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { CellTerminal } from "@/components/cell-terminal";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { cellQueries } from "@/queries/cells";
import {
  CenteredCellLoading,
  prefetchCellDetail,
} from "../../-shared/cell-route";

export const Route = createFileRoute("/cells/$cellId/chat")({
  loader: ({ context: { queryClient }, params }) => {
    prefetchCellDetail(queryClient, params.cellId);
    return null;
  },
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  const navigate = useNavigate({ from: "/cells/$cellId/chat" });
  const cellQuery = useQuery(cellQueries.detail(cellId));

  useEffect(() => {
    if (!cellQuery.data || cellQuery.data.status === "ready") {
      return;
    }

    navigate({
      to: "/cells/$cellId/provisioning",
      params: { cellId },
      replace: true,
    }).catch(() => {
      // navigation failures are surfaced by the router
    });
  }, [cellId, cellQuery.data, navigate]);

  const { theme } = useTheme();
  const themeMode =
    theme === "light" ||
    (theme === "system" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light"))
      ? "light"
      : "dark";

  const startupStatusMessage = "Starting OpenCode session";

  if (cellQuery.isError) {
    const loadErrorMessage =
      cellQuery.error instanceof Error
        ? cellQuery.error.message
        : "Failed to load chat status";

    return (
      <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
        <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
          <div className="flex w-full max-w-xl flex-col gap-3 border-2 border-destructive/60 bg-destructive/10 p-5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <p className="font-medium text-[11px] uppercase tracking-[0.2em]">
                Unable to load chat
              </p>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {loadErrorMessage}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => cellQuery.refetch()}
                type="button"
                variant="secondary"
              >
                Retry load
              </Button>
              <Button
                onClick={() => navigate({ to: "/" })}
                type="button"
                variant="outline"
              >
                Back to workspaces
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (cellQuery.isPending || !cellQuery.data) {
    return <CenteredCellLoading label="Loading chat status" />;
  }

  if (cellQuery.data.status !== "ready") {
    return <CenteredCellLoading label="Redirecting to provisioning" />;
  }

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
