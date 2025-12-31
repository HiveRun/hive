import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef, useState } from "react";
import { useXTerm } from "react-xtermjs";

import { Button } from "@/components/ui/button";
import { useCellTerminal } from "@/hooks/use-cell-terminal";
import { cellQueries } from "@/queries/cells";

import "@xterm/xterm/css/xterm.css";

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

type CellTerminalPanelProps = {
  cellId: string;
};

function CellTerminalPanel({ cellId }: CellTerminalPanelProps) {
  const [exitCode, setExitCode] = useState<number | null>(null);

  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>("");
  const { instance: terminal, ref: xtermRef } = useXTerm();

  const { status, error, sendInput, sendResize, shutdown } = useCellTerminal(
    cellId,
    {
      onOutput: (event) => {
        if (!terminal) {
          return;
        }
        terminal.write(event.data);
      },
      onExit: (event) => {
        setExitCode(event.code);
      },
    }
  );

  useEffect(() => {
    if (!terminal) {
      return;
    }

    // Configure terminal options in place to avoid touching constructor-only options like cols/rows
    terminal.options.cursorBlink = true;
    terminal.options.convertEol = true;
    const scrollback = 10_000;
    const fontSize = 13;

    terminal.options.scrollback = scrollback;
    terminal.options.fontSize = fontSize;
    terminal.options.theme = {
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
    };

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddon.fit();
    fitAddonRef.current = fitAddon;

    terminal.focus();
    terminal.writeln(`Connected to cell ${cellId}`);

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: local terminal input handling is intentionally explicit
    const dataDisposable = terminal.onData((data: string) => {
      for (const char of data) {
        if (char === "\r" || char === "\n") {
          const line = inputBufferRef.current;
          terminal.write("\r\n");
          const payload = line.length > 0 ? `${line}\n` : "\n";
          sendInput(payload);
          inputBufferRef.current = "";
        } else if (char === "\b" || char === "\x7f") {
          if (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
            terminal.write("\b \b");
          }
        } else if (char >= " " || char === "\t") {
          inputBufferRef.current += char;
          terminal.write(char);
        }
      }
    });

    return () => {
      dataDisposable.dispose();
      fitAddonRef.current = null;
      fitAddon.dispose();
    };
  }, [cellId, sendInput, terminal]);

  useEffect(() => {
    const handleResize = () => {
      if (!(terminal && fitAddonRef.current)) {
        return;
      }

      fitAddonRef.current.fit();
      sendResize(terminal.cols, terminal.rows);
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [sendResize, terminal]);

  const handleClear = () => {
    terminal?.clear();
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
        <div className="h-full w-full" ref={xtermRef} />
      </div>
    </div>
  );
}
