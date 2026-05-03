/* jscpd:ignore-start */
import "@xterm/xterm/css/xterm.css";

import type { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  API_BASE,
  appendTerminalOutput,
  SOCKET_RECONNECT_DELAY_MS,
  TERMINAL_FONT_FAMILY,
  useTerminalInputBatcher,
} from "@/components/terminal-shared";
import {
  clearTerminalTimers,
  keepExitedOrDisconnected,
  keepExitedOrOnline,
  recoverConnectingConnection,
  TerminalStatusHeader,
  terminalDataChunk,
  terminalExitCode,
  terminalFooter,
  terminalSnapshotOutput,
  terminalSocketErrorMessage,
  useCopyTerminalOutput,
  useTerminalResizeSync,
  useTerminalSocketSender,
  writeTerminalSnapshot,
} from "@/components/terminal-view-shared";
import { registerTerminalClipboard } from "@/lib/terminal-clipboard";
import {
  parseTerminalSocketMessage,
  toWebSocketUrl,
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
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputListenerRef = useRef<{ dispose: () => void } | null>(null);
  const outputRef = useRef<string>("");
  const sessionRef = useRef<RuntimeTerminalSession | null>(null);
  const socketCloseErrorRef = useRef<string | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<RuntimeTerminalSession | null>(null);
  const [setupDisplayState, setSetupDisplayState] =
    useState<SetupDisplayState>("unknown");

  const buildSocketEndpoint = useCallback(() => {
    const wsPath = streamPath.endsWith("/stream")
      ? `${streamPath.slice(0, -"/stream".length)}/ws`
      : streamPath;
    return toWebSocketUrl(`${API_BASE}${wsPath}`);
  }, [streamPath]);

  const sendSocketMessage = useTerminalSocketSender({
    setConnection,
    setErrorMessage,
    socketRef,
  });

  const sendInputMessage = useCallback(
    (data: string) => {
      sendSocketMessage({ type: "input", data });
    },
    [sendSocketMessage]
  );
  const { resetInputBatcher, sendInput } = useTerminalInputBatcher({
    enabled: allowInput && Boolean(inputPath),
    sendInputMessage,
  });

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

  const scheduleResizeSync = useTerminalResizeSync({
    resizeTimeoutRef,
    sendResize,
    shouldResize: () => sessionRef.current?.status === "running",
    terminalRef,
  });

  const copyTerminalOutput = useCopyTerminalOutput({
    outputRef,
    serializeAddonRef,
  });

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
      const socket = new WebSocket(buildSocketEndpoint());
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

          const snapshot = terminalSnapshotOutput(message);

          writeTerminalSnapshot({ outputRef, snapshot, terminal });
          if (snapshot.length > 0) {
            setConnection(keepExitedOrOnline);
          }
          return;
        }

        if (message.type === "data") {
          const terminal = terminalRef.current;
          if (!terminal) {
            return;
          }

          const chunk = terminalDataChunk(message);
          if (chunk.length === 0) {
            return;
          }

          terminal.write(chunk);
          outputRef.current = appendTerminalOutput(outputRef.current, chunk);
          setConnection(keepExitedOrOnline);
          return;
        }

        if (message.type === "exit") {
          const exitCode = terminalExitCode(message);
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
          const description = terminalSocketErrorMessage(message);
          if (description.toLowerCase().includes("terminal is not running")) {
            return;
          }
          setConnection(recoverConnectingConnection);
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

        setConnection(keepExitedOrDisconnected);
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
      const cleanupClipboard = registerTerminalClipboard({
        terminal,
        container: containerRef.current,
        canPaste: allowInput && Boolean(inputPath),
        onCopySuccess: () => {
          toast.success("Copied terminal selection");
        },
        onCopyError: () => {
          toast.error("Failed to copy terminal selection");
        },
      });

      resizeObserverRef.current = new ResizeObserver(() => {
        fitAddonRef.current?.fit();
        scheduleResizeSync();
      });
      resizeObserverRef.current.observe(containerRef.current);

      window.addEventListener("resize", scheduleResizeSync);
      connectStream();
      scheduleResizeSync();

      return () => {
        cleanupClipboard();
      };
    };

    let cleanupTerminalInteractions: (() => void) | null = null;

    initializeTerminal()
      .then((cleanup) => {
        cleanupTerminalInteractions = cleanup ?? null;
      })
      .catch((error) => {
        setConnection("disconnected");
        setErrorMessage(
          error instanceof Error ? error.message : "Terminal failed"
        );
      });

    return () => {
      disposed = true;
      cleanupTerminalInteractions?.();
      resetInputBatcher();
      sessionRef.current = null;
      socketCloseErrorRef.current = null;
      clearTerminalTimers({ reconnectTimeoutRef, resizeTimeoutRef });
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
    buildSocketEndpoint,
    inputPath,
    mode,
    resetInputBatcher,
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
  const footer = terminalFooter({
    emptyMessage,
    errorMessage,
    sessionCwd: session?.cwd,
  });

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border border-border/70 bg-card">
      <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3">
        <TerminalStatusHeader
          dotTone={displayDotTone}
          label={displayLabel}
          onCopyOutput={copyTerminalOutput}
          pid={session?.pid}
          title={title}
          tone={displayTone}
        />

        <div className="min-h-0 flex-1 border border-border/70 bg-[#050708] p-2">
          <div className="h-full min-h-0 w-full" ref={containerRef} />
        </div>

        {footer}
      </div>
    </div>
  );
}
/* jscpd:ignore-end */
