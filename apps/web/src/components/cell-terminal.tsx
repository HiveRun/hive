import "@xterm/xterm/css/xterm.css";

import type { Terminal as XTerm } from "@xterm/xterm";
import { Copy } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/api-base";

type ConnectionState = "connecting" | "online" | "disconnected" | "exited";

type TerminalSession = {
  sessionId: string;
  cellId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  startedAt: string;
};

const API_BASE = getApiBase();
const OUTPUT_BUFFER_LIMIT = 250_000;
const RESIZE_DEBOUNCE_MS = 120;
const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "MesloLGS NF", "CaskaydiaMono Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", "Geist Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Noto Color Emoji", monospace';

const appendOutput = (current: string, chunk: string): string => {
  const next = `${current}${chunk}`;
  if (next.length <= OUTPUT_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
};

export function CellTerminal({ cellId }: { cellId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const serializeAddonRef = useRef<{ serialize: () => string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const outputRef = useRef<string>("");
  const resizeTimeoutRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  const sendResize = useCallback(
    async (cols: number, rows: number) => {
      const response = await fetch(
        `${API_BASE}/api/cells/${cellId}/terminal/resize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cols, rows }),
        }
      );

      if (!response.ok) {
        throw new Error(`Resize failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        session?: TerminalSession;
      };

      if (payload.session) {
        setSession(payload.session);
      }
    },
    [cellId]
  );

  const sendInput = useCallback(
    (data: string) => {
      fetch(`${API_BASE}/api/cells/${cellId}/terminal/input`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data }),
      }).catch(() => {
        setConnection((current) =>
          current === "exited" ? "exited" : "disconnected"
        );
      });
    },
    [cellId]
  );

  const scheduleResizeSync = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal || typeof window === "undefined") {
      return;
    }

    if (resizeTimeoutRef.current !== null) {
      window.clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = window.setTimeout(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) {
        return;
      }
      sendResize(activeTerminal.cols, activeTerminal.rows).catch(() => {
        // ignore transient resize failures while reconnecting
      });
    }, RESIZE_DEBOUNCE_MS);
  }, [sendResize]);

  const copyTerminalOutput = useCallback(async () => {
    try {
      const serialized = serializeAddonRef.current?.serialize();
      const text =
        serialized && serialized.length > 0 ? serialized : outputRef.current;
      await navigator.clipboard.writeText(text);
      toast.success("Copied terminal output");
    } catch {
      toast.error("Failed to copy terminal output");
    }
  }, []);

  const restartTerminal = useCallback(async () => {
    setIsRestarting(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/cells/${cellId}/terminal/restart`,
        {
          method: "POST",
        }
      );
      if (!response.ok) {
        throw new Error(`Restart failed with ${response.status}`);
      }

      const payload = (await response.json()) as TerminalSession;
      setSession(payload);
      setConnection("online");
      setErrorMessage(null);

      const terminal = terminalRef.current;
      if (terminal) {
        terminal.write("\x1bc");
      }
      outputRef.current = "";
      toast.success("Terminal restarted");
    } catch {
      toast.error("Failed to restart terminal");
    } finally {
      setIsRestarting(false);
    }
  }, [cellId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    outputRef.current = "";
    setSession(null);
    setConnection("connecting");
    setErrorMessage(null);

    const connectStream = () => {
      const source = new EventSource(
        `${API_BASE}/api/cells/${cellId}/terminal/stream`
      );
      eventSourceRef.current = source;

      source.addEventListener("ready", (event) => {
        if (disposed) {
          return;
        }
        const payload = JSON.parse(
          (event as MessageEvent<string>).data
        ) as TerminalSession;
        setSession(payload);
        setConnection(payload.status === "exited" ? "exited" : "online");
        setErrorMessage(null);
        scheduleResizeSync();
      });

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: snapshot replay reconciles reconnect state.
      source.addEventListener("snapshot", (event) => {
        if (disposed) {
          return;
        }
        const terminal = terminalRef.current;
        if (!terminal) {
          return;
        }

        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          output: string;
        };
        const snapshot = payload.output ?? "";

        if (snapshot.startsWith(outputRef.current)) {
          const delta = snapshot.slice(outputRef.current.length);
          if (delta.length > 0) {
            terminal.write(delta);
          }
        } else {
          terminal.write("\x1bc");
          if (snapshot.length > 0) {
            terminal.write(snapshot);
          }
        }

        outputRef.current = snapshot;
      });

      source.addEventListener("data", (event) => {
        if (disposed) {
          return;
        }
        const terminal = terminalRef.current;
        if (!terminal) {
          return;
        }

        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          chunk: string;
        };
        const chunk = payload.chunk ?? "";
        if (chunk.length === 0) {
          return;
        }

        terminal.write(chunk);
        outputRef.current = appendOutput(outputRef.current, chunk);
        setConnection((current) =>
          current === "exited" ? "exited" : "online"
        );
      });

      source.addEventListener("exit", (event) => {
        if (disposed) {
          return;
        }
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          exitCode: number;
          signal: number | string | null;
        };
        setConnection("exited");
        setSession((current) =>
          current
            ? {
                ...current,
                status: "exited",
                exitCode: payload.exitCode,
              }
            : current
        );
      });

      source.onerror = () => {
        if (disposed) {
          return;
        }

        setConnection((current) =>
          current === "exited" ? "exited" : "disconnected"
        );
        setErrorMessage("Terminal stream disconnected. Reconnecting…");
      };
    };

    const initializeTerminal = async () => {
      const [{ Terminal }, { FitAddon }, { SerializeAddon }] =
        await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-serialize"),
        ]);

      if (disposed || !containerRef.current) {
        return;
      }

      const terminal = new Terminal({
        allowProposedApi: false,
        cols: 120,
        rows: 36,
        convertEol: true,
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 13,
        lineHeight: 1.4,
        scrollback: 10_000,
        theme: {
          background: "#050708",
          foreground: "#FFE9A8",
          cursor: "#F5A524",
          cursorAccent: "#050708",
          black: "#050708",
          brightBlack: "#6B7280",
          red: "#FF5C5C",
          brightRed: "#FF8F1F",
          green: "#8EDB5D",
          brightGreen: "#B4F28B",
          yellow: "#FFC857",
          brightYellow: "#FFE9A8",
          blue: "#2DD4BF",
          brightBlue: "#6DEFE0",
          magenta: "#7C5BFF",
          brightMagenta: "#A895FF",
          cyan: "#2DD4BF",
          brightCyan: "#8AF8EE",
          white: "#E5E7EB",
          brightWhite: "#FFFFFF",
        },
      });

      const fitAddon = new FitAddon();
      const serializeAddon = new SerializeAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(serializeAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminal.focus();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      serializeAddonRef.current = serializeAddon;

      terminal.onData((data) => {
        sendInput(data);
      });

      resizeObserverRef.current = new ResizeObserver(() => {
        fitAddonRef.current?.fit();
        scheduleResizeSync();
      });
      resizeObserverRef.current.observe(containerRef.current);

      window.addEventListener("resize", scheduleResizeSync);
      connectStream();
      scheduleResizeSync();
    };

    initializeTerminal().catch((error) => {
      setConnection("disconnected");
      setErrorMessage(
        error instanceof Error ? error.message : "Terminal failed"
      );
    });

    return () => {
      disposed = true;
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
      window.removeEventListener("resize", scheduleResizeSync);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [cellId, scheduleResizeSync, sendInput]);

  const connectionLabelMap: Record<ConnectionState, string> = {
    online: "Connected",
    connecting: "Connecting",
    exited: "Exited",
    disconnected: "Disconnected",
  };
  const statusToneMap: Record<ConnectionState, string> = {
    online: "text-primary",
    connecting: "text-muted-foreground",
    exited: "text-secondary-foreground",
    disconnected: "text-destructive",
  };
  const connectionDetailMap: Record<ConnectionState, string> = {
    online: "Terminal stream connected",
    connecting: "Connecting to terminal stream",
    exited: "Shell exited. Restart to reconnect",
    disconnected: "Terminal stream disconnected. Reconnecting",
  };
  const connectionDotToneMap: Record<ConnectionState, string> = {
    online: "bg-[#2DD4BF]",
    connecting: "animate-pulse bg-[#FFC857]",
    exited: "bg-muted-foreground",
    disconnected: "animate-pulse bg-[#FF5C5C]",
  };
  const connectionLabel = connectionLabelMap[connection];
  const statusTone = statusToneMap[connection];
  const connectionDetail = connectionDetailMap[connection];
  const connectionDotTone = connectionDotToneMap[connection];
  const restartLabel =
    connection === "disconnected" ? "Reconnect" : "Restart shell";
  let footer: ReactNode = null;
  if (errorMessage) {
    footer = (
      <p className="text-destructive text-xs uppercase tracking-[0.2em]">
        {errorMessage}
      </p>
    );
  } else if (session) {
    footer = (
      <p className="truncate text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
        {session.cwd}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card">
      <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="font-semibold text-[11px] text-foreground uppercase tracking-[0.3em]">
              Cell Terminal
            </p>
            <span
              className={`text-[11px] uppercase tracking-[0.25em] ${statusTone}`}
            >
              {connectionLabel}
            </span>
            {session ? (
              <span className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
                pid {session.pid}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              className="h-7 px-2"
              onClick={copyTerminalOutput}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              className="h-7 px-2 text-[10px] uppercase tracking-[0.2em]"
              disabled={isRestarting}
              onClick={restartTerminal}
              size="sm"
              type="button"
              variant="outline"
            >
              {isRestarting ? "Restarting" : restartLabel}
            </Button>
            <span
              className="inline-flex h-7 items-center gap-1.5 border border-border/70 px-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]"
              title={connectionDetail}
            >
              <span className={`h-2 w-2 rounded-full ${connectionDotTone}`} />
              {connectionLabel}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 border border-border/70 bg-[#050708] p-2">
          <div className="h-full min-h-0 w-full" ref={containerRef} />
        </div>

        {footer}
      </div>
    </div>
  );
}
