import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";

import { Button } from "@/components/ui/button";
import { useCellTerminal } from "@/hooks/use-cell-terminal";
import { cellQueries } from "@/queries/cells";

import "xterm/css/xterm.css";

// biome-ignore lint/suspicious/noExplicitAny: Route tree generator is unaware of the terminal path until next regeneration
export const Route = createFileRoute("/cells/$cellId/terminal" as any)({
  component: CellTerminalRoute,
});

function CellTerminalRoute() {
  const { cellId } = Route.useParams();
  const cellQuery = useQuery(cellQueries.detail(cellId));

  if (cellQuery.isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground">
        Loading cell…
      </div>
    );
  }

  if (cellQuery.error) {
    const message =
      cellQuery.error instanceof Error
        ? cellQuery.error.message
        : "Failed to load cell";
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-destructive/50 bg-destructive/10 text-destructive">
        {message}
      </div>
    );
  }

  const cell = cellQuery.data;
  const isArchived = cell?.status === "archived";

  if (!cell) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground">
        Unable to load cell. It may have been deleted.
      </div>
    );
  }

  if (isArchived) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-sm border-2 border-border bg-card text-muted-foreground">
        Archived cells cannot open terminals. Restore the branch to reopen the
        workspace.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full w-full flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
              Cell Terminal
            </p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
              Run shell commands directly in this cell&apos;s worktree.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
            <span>Workspace · {cell.workspacePath ?? "Unavailable"}</span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <CellTerminalPanel cellId={cellId} />
        </div>
      </div>
    </div>
  );
}

const MIN_TERMINAL_COLUMNS = 40;
const MIN_TERMINAL_ROWS = 10;
const APPROXIMATE_CHAR_WIDTH_PX = 8;
const APPROXIMATE_CHAR_HEIGHT_PX = 16;

type CellTerminalPanelProps = {
  cellId: string;
};

function CellTerminalPanel({ cellId }: CellTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const { status, error, sendInput, sendResize, shutdown } = useCellTerminal(
    cellId,
    {
      onOutput: (event) => {
        if (!terminalRef.current) {
          return;
        }
        terminalRef.current.write(event.data);
      },
      onExit: (event) => {
        setExitCode(event.code);
      },
    }
  );

  useEffect(() => {
    const existing = terminalRef.current;
    if (existing) {
      existing.dispose();
      terminalRef.current = null;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 10_000,
      fontSize: 13,
      theme: {
        background: "#050708",
        foreground: "#e5e7eb",
        cursor: "#f5a524",
        black: "#111827",
        brightBlack: "#6b7280",
        red: "#f97373",
        brightRed: "#fecaca",
        green: "#4ade80",
        brightGreen: "#bbf7d0",
        yellow: "#facc15",
        brightYellow: "#fef9c3",
        blue: "#60a5fa",
        brightBlue: "#bfdbfe",
        magenta: "#a855f7",
        brightMagenta: "#e9d5ff",
        cyan: "#22d3ee",
        brightCyan: "#a5f3fc",
        white: "#e5e7eb",
        brightWhite: "#f9fafb",
      },
    });

    terminalRef.current = terminal;

    if (containerRef.current) {
      terminal.open(containerRef.current);
      terminal.focus();
      terminal.writeln(`Connected to cell ${cellId}`);
    }

    const dataDisposable = terminal.onData((data: string) => {
      sendInput(data);
    });

    return () => {
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [cellId, sendInput]);

  useEffect(() => {
    const handleResize = () => {
      const terminal = terminalRef.current;
      const element = containerRef.current;
      if (!terminal) {
        return;
      }
      if (!element) {
        return;
      }

      const width = element.clientWidth;
      const height = element.clientHeight;

      if (!width) {
        return;
      }
      if (!height) {
        return;
      }

      const approxCharWidth = APPROXIMATE_CHAR_WIDTH_PX;
      const approxCharHeight = APPROXIMATE_CHAR_HEIGHT_PX;

      const cols = Math.max(
        MIN_TERMINAL_COLUMNS,
        Math.floor(width / approxCharWidth)
      );
      const rows = Math.max(
        MIN_TERMINAL_ROWS,
        Math.floor(height / approxCharHeight)
      );

      terminal.resize(cols, rows);
      sendResize(cols, rows);
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [sendResize]);

  const handleClear = () => {
    terminalRef.current?.clear();
  };

  const statusLabelMap: Record<string, string> = {
    idle: "Idle",
    connecting: "Connecting",
    open: "Connected",
    error: "Error",
    closed: "Closed",
  };

  const statusLabel = statusLabelMap[status] ?? "Idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
        <div className="flex flex-wrap items-center gap-3">
          <span>Connection · {statusLabel}</span>
          {exitCode !== null ? <span>Exit · {exitCode}</span> : null}
          {error ? (
            <span className="text-destructive">Error · {error}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleClear}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear
          </Button>
          <Button
            disabled={status !== "open"}
            onClick={shutdown}
            size="sm"
            type="button"
            variant="destructive"
          >
            Close Session
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border bg-background">
        <div className="h-full w-full" ref={containerRef} />
      </div>
    </div>
  );
}
