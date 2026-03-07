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
import { isMouseMovementInputChunk } from "@/lib/terminal-input";
import {
  createTerminalSocket,
  parseTerminalSocketMessage,
  sendTerminalSocketMessage,
  type TerminalSocketLike,
} from "@/lib/terminal-websocket";

type ConnectionState =
  | "connecting"
  | "idle"
  | "online"
  | "disconnected"
  | "exited";

type RuntimeTerminalSession = {
  sessionId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  startedAt: string;
};

type SetupTerminalState = "active" | "completed" | "failed" | "pending";
type SetupDisplayState = SetupTerminalState | "unknown";

type ReadyPayload = {
  session: RuntimeTerminalSession | null;
  setupState?: SetupTerminalState;
  lastSetupError?: string | null;
};

const API_BASE = getApiBase();
const OUTPUT_BUFFER_LIMIT = 250_000;
const RESIZE_DEBOUNCE_MS = 120;
const SOCKET_RECONNECT_DELAY_MS = 800;
const INPUT_BATCH_BASE_WINDOW_MS = 16;
const INPUT_BATCH_MAX_WINDOW_MS = 24;
const INPUT_BATCH_WINDOW_STEP_MS = 8;
const INPUT_BATCH_HIGH_CHUNK_THRESHOLD = 6;
const INPUT_BATCH_FLUSH_SIZE = 1024;
const INPUT_BATCH_HIGH_CHUNK_MIN_BUFFER = 256;
const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "MesloLGS NF", "CaskaydiaMono Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", "Geist Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Noto Color Emoji", monospace';

const appendOutput = (current: string, chunk: string): string => {
  const next = `${current}${chunk}`;
  if (next.length <= OUTPUT_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
};

const shouldFlushMouseBatch = (bufferedLength: number) =>
  bufferedLength >= INPUT_BATCH_FLUSH_SIZE;

export function PtyStreamTerminal({
  title,
  streamPath,
  resizePath: _resizePath,
  inputPath,
  allowInput = false,
  emptyMessage = "No output yet.",
  mode = "generic",
}: {
  title: string;
  streamPath: string;
  resizePath: string;
  inputPath?: string;
  allowInput?: boolean;
  emptyMessage?: string;
  mode?: "generic" | "setup";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const serializeAddonRef = useRef<{ serialize: () => string } | null>(null);
  const socketRef = useRef<TerminalSocketLike | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputListenerRef = useRef<{ dispose: () => void } | null>(null);
  const outputRef = useRef<string>("");
  const sessionRef = useRef<RuntimeTerminalSession | null>(null);
  const socketCloseErrorRef = useRef<string | null>(null);
  const inputBufferRef = useRef<string>("");
  const inputFlushTimeoutRef = useRef<number | null>(null);
  const inputBatchWindowMsRef = useRef(INPUT_BATCH_BASE_WINDOW_MS);
  const inputBatchChunkCountRef = useRef(0);
  const resizeTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<RuntimeTerminalSession | null>(null);
  const [setupDisplayState, setSetupDisplayState] =
    useState<SetupDisplayState>("unknown");

  const buildTerminalSocketPath = useCallback(() => streamPath, [streamPath]);

  const sendSocketMessage = useCallback(
    (message: { type: string; [key: string]: unknown }) => {
      const sent = sendTerminalSocketMessage(socketRef.current, message);
      if (sent) {
        return true;
      }

      setConnection((current) =>
        current === "exited" ? "exited" : "disconnected"
      );
      setErrorMessage("Terminal socket disconnected. Reconnecting…");
      return false;
    },
    []
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const sent = sendSocketMessage({ type: "resize", cols, rows });
      if (!sent) {
        throw new Error("Terminal socket unavailable");
      }

      setSession((current) => {
        const next = current
          ? {
              ...current,
              cols,
              rows,
            }
          : current;
        sessionRef.current = next;
        return next;
      });
    },
    [sendSocketMessage]
  );

  const updateBatchWindow = useCallback(
    (chunkCount: number, queuedLength: number, forceImmediate: boolean) => {
      if (forceImmediate) {
        inputBatchWindowMsRef.current = INPUT_BATCH_BASE_WINDOW_MS;
        return;
      }

      if (
        chunkCount >= INPUT_BATCH_HIGH_CHUNK_THRESHOLD &&
        queuedLength >= INPUT_BATCH_HIGH_CHUNK_MIN_BUFFER
      ) {
        inputBatchWindowMsRef.current = Math.min(
          INPUT_BATCH_MAX_WINDOW_MS,
          inputBatchWindowMsRef.current + INPUT_BATCH_WINDOW_STEP_MS
        );
        return;
      }

      inputBatchWindowMsRef.current = Math.max(
        INPUT_BATCH_BASE_WINDOW_MS,
        inputBatchWindowMsRef.current - INPUT_BATCH_WINDOW_STEP_MS
      );
    },
    []
  );

  const flushQueuedInput = useCallback(
    (forceImmediate = false) => {
      if (
        typeof window !== "undefined" &&
        inputFlushTimeoutRef.current !== null
      ) {
        window.clearTimeout(inputFlushTimeoutRef.current);
        inputFlushTimeoutRef.current = null;
      }

      const queued = inputBufferRef.current;
      if (queued.length === 0) {
        return;
      }

      const chunkCount = inputBatchChunkCountRef.current;
      inputBufferRef.current = "";
      inputBatchChunkCountRef.current = 0;
      updateBatchWindow(chunkCount, queued.length, forceImmediate);
      sendSocketMessage({ type: "input", data: queued });
    },
    [sendSocketMessage, updateBatchWindow]
  );

  const discardQueuedMouseInput = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      inputFlushTimeoutRef.current !== null
    ) {
      window.clearTimeout(inputFlushTimeoutRef.current);
      inputFlushTimeoutRef.current = null;
    }

    inputBufferRef.current = "";
    inputBatchChunkCountRef.current = 0;
    inputBatchWindowMsRef.current = INPUT_BATCH_BASE_WINDOW_MS;
  }, []);

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

      if (sessionRef.current?.status !== "running") {
        return;
      }

      try {
        sendResize(activeTerminal.cols, activeTerminal.rows);
      } catch {
        // ignore transient resize failures while reconnecting
      }
    }, RESIZE_DEBOUNCE_MS);
  }, [sendResize]);

  const sendInput = useCallback(
    (data: string) => {
      if (!(allowInput && inputPath)) {
        return;
      }

      if (!isMouseMovementInputChunk(data)) {
        discardQueuedMouseInput();
        sendSocketMessage({ type: "input", data });
        return;
      }

      inputBufferRef.current += data;
      inputBatchChunkCountRef.current += 1;
      if (shouldFlushMouseBatch(inputBufferRef.current.length)) {
        flushQueuedInput(true);
        return;
      }

      if (typeof window === "undefined") {
        return;
      }

      if (inputFlushTimeoutRef.current !== null) {
        return;
      }

      inputFlushTimeoutRef.current = window.setTimeout(() => {
        inputFlushTimeoutRef.current = null;
        flushQueuedInput();
      }, inputBatchWindowMsRef.current);
    },
    [
      allowInput,
      discardQueuedMouseInput,
      flushQueuedInput,
      inputPath,
      sendSocketMessage,
    ]
  );

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    outputRef.current = "";
    sessionRef.current = null;
    socketCloseErrorRef.current = null;
    setSession(null);
    setConnection("connecting");
    setErrorMessage(null);
    setSetupDisplayState("unknown");

    const connectStream = () => {
      const socket = createTerminalSocket({
        apiBase: API_BASE,
        terminalPath: buildTerminalSocketPath(),
      });
      socketRef.current = socket;
      socketCloseErrorRef.current = null;

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: websocket messages preserve setup + terminal session state transitions.
      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        const message = parseTerminalSocketMessage(event);
        if (!message) {
          return;
        }

        if (message.type === "ready") {
          const payload = {
            session:
              (message.session as RuntimeTerminalSession | null | undefined) ??
              null,
            setupState:
              typeof message.setupState === "string"
                ? (message.setupState as SetupTerminalState)
                : undefined,
            lastSetupError:
              typeof message.lastSetupError === "string"
                ? message.lastSetupError
                : null,
          } satisfies ReadyPayload;

          const readySession = payload.session;
          setSession(readySession);
          sessionRef.current = readySession;
          socketCloseErrorRef.current = null;

          let nextState: ConnectionState;
          if (payload.setupState === "active") {
            nextState = "online";
          } else if (
            payload.setupState === "completed" ||
            payload.setupState === "failed"
          ) {
            nextState = "exited";
          } else if (payload.setupState === "pending") {
            nextState = "idle";
          } else if (readySession?.status === "exited") {
            nextState = "exited";
          } else if (readySession) {
            nextState = "online";
          } else {
            nextState = "idle";
          }

          setConnection(nextState);

          if (mode === "setup") {
            if (payload.setupState) {
              setSetupDisplayState(payload.setupState);
            } else if (readySession?.status === "running") {
              setSetupDisplayState("active");
            }
          }

          if (payload.setupState === "failed" && payload.lastSetupError) {
            setErrorMessage(payload.lastSetupError);
          } else {
            setErrorMessage(null);
          }
          const activeTerminal = terminalRef.current;
          if (
            activeTerminal &&
            readySession &&
            (readySession.cols !== activeTerminal.cols ||
              readySession.rows !== activeTerminal.rows)
          ) {
            scheduleResizeSync();
          }
          return;
        }

        if (message.type === "snapshot") {
          const terminal = terminalRef.current;
          if (!terminal) {
            return;
          }

          const snapshot =
            typeof message.output === "string" ? message.output : "";

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
          if (snapshot.length > 0) {
            setConnection((current) =>
              current === "exited" ? "exited" : "online"
            );
          }
          return;
        }

        if (message.type === "data") {
          const terminal = terminalRef.current;
          if (!terminal) {
            return;
          }

          const chunk = typeof message.chunk === "string" ? message.chunk : "";
          if (chunk.length === 0) {
            return;
          }

          terminal.write(chunk);
          outputRef.current = appendOutput(outputRef.current, chunk);
          setConnection((current) =>
            current === "exited" ? "exited" : "online"
          );
          return;
        }

        if (message.type === "exit") {
          const exitCode =
            typeof message.exitCode === "number" ? message.exitCode : 0;
          setConnection("exited");
          if (mode === "setup") {
            setSetupDisplayState(exitCode === 0 ? "completed" : "failed");
          }
          setSession((current) => {
            const next: RuntimeTerminalSession | null = current
              ? {
                  ...current,
                  status: "exited",
                  exitCode,
                }
              : current;
            sessionRef.current = next;
            return next;
          });
          return;
        }

        if (message.type === "error") {
          const description =
            typeof message.message === "string"
              ? message.message
              : "Terminal socket error";
          if (description.toLowerCase().includes("terminal is not running")) {
            return;
          }
          setConnection((current) => {
            if (current === "exited") {
              return "exited";
            }

            if (current === "connecting") {
              return "online";
            }

            return current;
          });
          setErrorMessage(description);
          socketCloseErrorRef.current = description;
        }
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }

        const closeErrorMessage = socketCloseErrorRef.current;
        socketCloseErrorRef.current = null;

        setConnection((current) =>
          current === "exited" ? "exited" : "disconnected"
        );
        setErrorMessage(
          closeErrorMessage ?? "Terminal socket disconnected. Reconnecting…"
        );

        if (reconnectTimeoutRef.current !== null) {
          return;
        }

        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (disposed) {
            return;
          }

          connectStream();
        }, SOCKET_RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket.close();
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
        disableStdin: !(allowInput && inputPath),
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

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      serializeAddonRef.current = serializeAddon;

      inputListenerRef.current?.dispose();
      inputListenerRef.current =
        allowInput && inputPath
          ? terminal.onData((data) => {
              sendInput(data);
            })
          : null;

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
      if (inputFlushTimeoutRef.current !== null) {
        window.clearTimeout(inputFlushTimeoutRef.current);
        inputFlushTimeoutRef.current = null;
      }
      inputBufferRef.current = "";
      inputBatchChunkCountRef.current = 0;
      inputBatchWindowMsRef.current = INPUT_BATCH_BASE_WINDOW_MS;
      sessionRef.current = null;
      socketCloseErrorRef.current = null;
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      window.removeEventListener("resize", scheduleResizeSync);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      inputListenerRef.current?.dispose();
      inputListenerRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [
    allowInput,
    buildTerminalSocketPath,
    inputPath,
    mode,
    scheduleResizeSync,
    sendInput,
  ]);

  const connectionLabelMap: Record<ConnectionState, string> = {
    online: "Connected",
    connecting: "Connecting",
    idle: "Idle",
    exited: "Exited",
    disconnected: "Disconnected",
  };
  const statusToneMap: Record<ConnectionState, string> = {
    online: "text-primary",
    connecting: "text-muted-foreground",
    idle: "text-muted-foreground",
    exited: "text-secondary-foreground",
    disconnected: "text-destructive",
  };
  const connectionDotToneMap: Record<ConnectionState, string> = {
    online: "bg-[#2DD4BF]",
    connecting: "animate-pulse bg-[#FFC857]",
    idle: "bg-muted-foreground",
    exited: "bg-muted-foreground",
    disconnected: "animate-pulse bg-[#FF5C5C]",
  };

  const connectionLabel = connectionLabelMap[connection];
  const statusTone = statusToneMap[connection];
  const connectionDotTone = connectionDotToneMap[connection];

  let displayLabel = connectionLabel;
  let displayTone = statusTone;
  let displayDotTone = connectionDotTone;
  if (mode === "setup") {
    if (setupDisplayState === "completed") {
      displayLabel = "Completed";
      displayTone = "text-primary";
      displayDotTone = "bg-[#2DD4BF]";
    } else if (setupDisplayState === "failed") {
      displayLabel = "Failed";
      displayTone = "text-destructive";
      displayDotTone = "bg-[#FF5C5C]";
    } else if (setupDisplayState === "active") {
      displayLabel = "Running";
    } else if (setupDisplayState === "pending") {
      displayLabel = "Pending";
    }
  }
  let footer: ReactNode;
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
  } else {
    footer = (
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border border-border/70 bg-card">
      <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3">
        <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="font-semibold text-[11px] text-foreground uppercase tracking-[0.3em]">
              {title}
            </p>
            <span
              className={`text-[11px] uppercase tracking-[0.25em] ${displayTone}`}
            >
              {displayLabel}
            </span>
            {session?.pid ? (
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
            <span className="inline-flex h-7 items-center gap-1.5 border border-border/70 px-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              <span className={`h-2 w-2 rounded-full ${displayDotTone}`} />
              {displayLabel}
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
