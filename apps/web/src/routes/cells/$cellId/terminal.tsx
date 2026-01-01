import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

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
  const [searchQuery, setSearchQuery] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>("");
  const searchAddonRef = useRef<SearchAddon | null>(null);

  const { status, error, sendInput, sendResize, shutdown } = useCellTerminal(
    cellId,
    {
      onOutput: (event) => {
        termRef.current?.write(event.data);
      },
      onExit: (event) => {
        setExitCode(event.code);
      },
    }
  );

  useEffect(() => {
    let disposed = false;
    let fitAddon: FitAddon | null = null;

    const setup = () => {
      try {
        const term = new Terminal({
          cursorBlink: true,
          convertEol: true,
          fontSize: 13,
          scrollback: 10_000,
          theme: {
            background: "#050708",
            foreground: "#e5e7eb",
            cursor: "#f5a524",
          },
        });

        if (disposed) {
          term.dispose();
          return;
        }

        const webLinksAddon = new WebLinksAddon();
        term.loadAddon(webLinksAddon);

        const searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);
        searchAddonRef.current = searchAddon;

        termRef.current = term;

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        const container = containerRef.current;
        if (container) {
          term.open(container);
          const handlePointerDown = () => {
            const activeElement = document.activeElement;
            if (
              activeElement instanceof HTMLElement &&
              activeElement !== container
            ) {
              activeElement.blur();
            }
            term.focus();
          };
          container.addEventListener("pointerdown", handlePointerDown);
        }

        fitAddon.fit();
        fitAddonRef.current = fitAddon;

        term.focus();
        term.writeln(`Connected to cell ${cellId}`);

        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Alt+Backspace handler is intentionally explicit
        term.attachCustomKeyEventHandler((event) => {
          if (event.key === "Backspace" && event.altKey) {
            const buffer = inputBufferRef.current;
            if (!buffer) {
              event.preventDefault();
              return false;
            }

            const lastIndex = buffer.length - 1;
            let end = lastIndex;
            while (end >= 0 && buffer[end] === " ") {
              end -= 1;
            }
            let start = end;
            while (start >= 0 && buffer[start] !== " ") {
              start -= 1;
            }

            const charsToDelete = lastIndex - start;
            if (charsToDelete > 0) {
              inputBufferRef.current = buffer.slice(0, start + 1);
              const eraseSequence = "\b \b".repeat(charsToDelete);
              term.write(eraseSequence);
            }

            event.preventDefault();
            return false;
          }

          return true;
        });

        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: local terminal input handling is intentionally explicit
        const dataDisposable = term.onData((data: string) => {
          for (const char of data) {
            if (char === "\r" || char === "\n") {
              const line = inputBufferRef.current;
              term.write("\r\n");
              const payload = line.length > 0 ? `${line}\n` : "\n";
              sendInput(payload);
              inputBufferRef.current = "";
            } else if (char === "\b" || char === "\x7f") {
              if (inputBufferRef.current.length > 0) {
                inputBufferRef.current = inputBufferRef.current.slice(0, -1);
                term.write("\b \b");
              }
            } else if (char >= " " || char === "\t") {
              inputBufferRef.current += char;
              term.write(char);
            }
          }
        });

        const handleResize = () => {
          if (!fitAddon) {
            return;
          }
          if (!term) {
            return;
          }
          fitAddon.fit();
          sendResize(term.cols, term.rows);
        };

        handleResize();
        window.addEventListener("resize", handleResize);

        return () => {
          dataDisposable.dispose();
          window.removeEventListener("resize", handleResize);
          fitAddonRef.current = null;
          fitAddon?.dispose();
          term.dispose();
          termRef.current = null;
        };
      } catch {
        // If Ghostty fails to load, we leave the terminal empty.
      }
    };

    const cleanup = setup();

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, [cellId, sendInput, sendResize]);

  const handleSearchNext = () => {
    const addon = searchAddonRef.current;
    if (!(addon && searchQuery)) {
      return;
    }
    addon.findNext(searchQuery);
  };

  const handleSearchPrev = () => {
    const addon = searchAddonRef.current;
    if (!(addon && searchQuery)) {
      return;
    }
    addon.findPrevious(searchQuery);
  };

  const handleClear = () => {
    termRef.current?.clear();
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
          <input
            className="h-7 w-28 rounded border border-border bg-background px-2 text-xs"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            value={searchQuery}
          />
          <Button
            onClick={handleSearchPrev}
            size="sm"
            type="button"
            variant="outline"
          >
            Prev
          </Button>
          <Button
            onClick={handleSearchNext}
            size="sm"
            type="button"
            variant="outline"
          >
            Next
          </Button>
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
