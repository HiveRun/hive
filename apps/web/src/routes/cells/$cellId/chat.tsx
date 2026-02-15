import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { CellTerminal } from "@/components/cell-terminal";
import { useTheme } from "@/components/theme-provider";
import { cellQueries } from "@/queries/cells";

const PROVISIONING_POLL_MS = 1500;

export const Route = createFileRoute("/cells/$cellId/chat")({
  component: CellChat,
});

function CellChat() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery({
    ...cellQueries.detail(cellId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "spawning" || status === "pending"
        ? PROVISIONING_POLL_MS
        : false;
    },
  });
  const { theme } = useTheme();
  const themeMode =
    theme === "light" ||
    (theme === "system" &&
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light"))
      ? "light"
      : "dark";

  let startupStatusMessage = "Starting OpenCode session";
  if (cellQuery.data?.status === "spawning") {
    startupStatusMessage = "Provisioning workspace and services";
  } else if (cellQuery.data?.status === "pending") {
    startupStatusMessage = "Preparing agent session";
  }

  const isProvisioning =
    cellQuery.data?.status === "spawning" ||
    cellQuery.data?.status === "pending";

  if (isProvisioning) {
    return (
      <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
        <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 border-2 border-border/70 bg-muted/20 px-5 py-4">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
              {startupStatusMessage}
            </p>
            <p className="max-w-[36ch] text-center text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
              Chat attaches automatically when provisioning reaches ready.
            </p>
          </div>
        </div>
      </div>
    );
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
