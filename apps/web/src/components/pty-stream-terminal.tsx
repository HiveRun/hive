import "@xterm/xterm/css/xterm.css";

import type { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/components/terminal-shared";
import {
  assignTerminalSocketMessageHandler as assignStreamSocketMessageHandler,
  disposeTerminalRuntime as disposeStreamRuntime,
  handleTerminalDataMessage as handleStreamDataMessage,
  handleTerminalExitMessage as handleStreamExitMessage,
  handleTerminalSocketClose as handleStreamSocketClose,
  initializeTerminalInteractions as initializeStreamInteractions,
  keepExitedOrOnline as keepExitedOrStreaming,
  loadTerminalBaseModules as loadStreamTerminalModules,
  recoverConnectingConnection as recoverStreamConnection,
  registerTerminalResizeObserver as registerStreamResizeObserver,
  registerTerminalSelectionCopy as registerStreamSelectionCopy,
  BASE_TERMINAL_OPTIONS as STREAM_TERMINAL_OPTIONS,
  TerminalFrame as StreamTerminalFrame,
  terminalConnectionPresentation as streamConnectionPresentation,
  terminalSocketErrorMessage as streamSocketErrorMessage,
  terminalFooter as streamTerminalFooter,
  syncTerminalSizeFromSession as syncStreamSizeFromSession,
  type TerminalRuntimeSession,
  useTerminalSocketControls as useStreamSocketControls,
  writeTerminalSnapshotMessage as writeStreamSnapshotMessage,
} from "@/components/terminal-view-shared";
import { toWebSocketUrl } from "@/lib/terminal-websocket";

type ConnectionState =
  | "connecting"
  | "idle"
  | "online"
  | "disconnected"
  | "exited";

type RuntimeTerminalSession = TerminalRuntimeSession;

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
  const streamContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const streamFitAddonRef = useRef<{ fit: () => void } | null>(null);
  const streamSerializeAddonRef = useRef<{ serialize: () => string } | null>(
    null
  );
  const streamSocketRef = useRef<WebSocket | null>(null);
  const streamResizeObserverRef = useRef<ResizeObserver | null>(null);
  const streamOutputRef = useRef<string>("");
  const activeSessionRef = useRef<RuntimeTerminalSession | null>(null);
  const streamSocketCloseErrorRef = useRef<string | null>(null);
  const streamResizeTimeoutRef = useRef<number | null>(null);
  const streamReconnectTimeoutRef = useRef<number | null>(null);
  const inputListenerRef = useRef<{ dispose: () => void } | null>(null);
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

  const {
    copyTerminalOutput,
    resetInputBatcher,
    scheduleResizeSync,
    sendInput,
  } = useStreamSocketControls({
    inputEnabled: allowInput && Boolean(inputPath),
    outputRef: streamOutputRef,
    resizeTimeoutRef: streamResizeTimeoutRef,
    serializeAddonRef: streamSerializeAddonRef,
    sessionRef: activeSessionRef,
    setConnection,
    setErrorMessage,
    setSession,
    shouldResize: () => activeSessionRef.current?.status === "running",
    socketRef: streamSocketRef,
    terminalRef: xtermRef,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    streamOutputRef.current = "";
    activeSessionRef.current = null;
    streamSocketCloseErrorRef.current = null;
    setSession(null);
    setConnection("connecting");
    setErrorMessage(null);
    setSetupDisplayState("unknown");

    const connectStream = () => {
      const socket = new WebSocket(buildSocketEndpoint());
      streamSocketRef.current = socket;
      streamSocketCloseErrorRef.current = null;

      assignStreamSocketMessageHandler({
        isDisposed: () => disposed,
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: setup and PTY websocket states share one ordered event matrix.
        onMessage: (message) => {
          if (message.type === "ready") {
            const payload = {
              session:
                (message.session as
                  | RuntimeTerminalSession
                  | null
                  | undefined) ?? null,
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
            activeSessionRef.current = readySession;
            streamSocketCloseErrorRef.current = null;

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
            if (readySession) {
              syncStreamSizeFromSession({
                cols: readySession.cols,
                rows: readySession.rows,
                scheduleResizeSync,
                terminalRef: xtermRef,
              });
            }
            return;
          }

          if (message.type === "snapshot") {
            const snapshotResult = writeStreamSnapshotMessage({
              message,
              outputRef: streamOutputRef,
              terminalRef: xtermRef,
            });
            if (!snapshotResult) {
              return;
            }
            if (snapshotResult.snapshot.length > 0) {
              setConnection(keepExitedOrStreaming);
            }
            return;
          }

          if (message.type === "data") {
            handleStreamDataMessage({
              message,
              outputRef: streamOutputRef,
              setConnection,
              terminalRef: xtermRef,
            });
            return;
          }

          if (message.type === "exit") {
            handleStreamExitMessage({
              afterExit: (exitCode, next) => {
                if (mode === "setup") {
                  setSetupDisplayState(exitCode === 0 ? "completed" : "failed");
                }
                activeSessionRef.current = next;
              },
              message,
              setConnection,
              setSession,
            });
            return;
          }

          if (message.type === "error") {
            const description = streamSocketErrorMessage(message);
            if (description.toLowerCase().includes("terminal is not running")) {
              return;
            }
            setConnection(recoverStreamConnection);
            setErrorMessage(description);
            streamSocketCloseErrorRef.current = description;
          }
        },
        socket,
      });

      socket.onclose = () => {
        handleStreamSocketClose({
          connectStream,
          isDisposed: () => disposed,
          reconnectTimeoutRef: streamReconnectTimeoutRef,
          setConnection,
          setErrorMessage,
          socketCloseErrorRef: streamSocketCloseErrorRef,
        });
      };

      socket.addEventListener("error", () => {
        socket.close();
      });
    };

    const initializeTerminal = async () => {
      const terminalModules = await loadStreamTerminalModules();
      const { Terminal } = terminalModules[0];
      const { FitAddon } = terminalModules[1];
      const { SerializeAddon } = terminalModules[2];

      if (disposed || !streamContainerRef.current) {
        return;
      }

      const terminal = new Terminal({
        ...STREAM_TERMINAL_OPTIONS,
        disableStdin: !(allowInput && inputPath),
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
      terminal.open(streamContainerRef.current);
      fitAddon.fit();

      xtermRef.current = terminal;
      streamFitAddonRef.current = fitAddon;
      streamSerializeAddonRef.current = serializeAddon;

      inputListenerRef.current?.dispose();
      inputListenerRef.current =
        allowInput && inputPath
          ? terminal.onData((data) => {
              sendInput(data);
            })
          : null;
      const cleanupClipboard = registerStreamSelectionCopy({
        terminal,
        container: streamContainerRef.current,
        canPaste: allowInput && Boolean(inputPath),
      });

      registerStreamResizeObserver({
        container: streamContainerRef.current,
        fitAddonRef: streamFitAddonRef,
        resizeObserverRef: streamResizeObserverRef,
        scheduleResizeSync,
      });

      window.addEventListener("resize", scheduleResizeSync);
      connectStream();
      scheduleResizeSync();

      return () => {
        cleanupClipboard();
      };
    };

    let cleanupTerminalInteractions: (() => void) | null = null;

    const storeStreamCleanup = (cleanup: (() => void) | null) => {
      cleanupTerminalInteractions = cleanup;
    };
    initializeStreamInteractions({
      setErrorMessage,
      onCleanupReady: storeStreamCleanup,
      setConnection,
      initializeTerminal,
    });

    return () => {
      disposed = true;
      resetInputBatcher();
      activeSessionRef.current = null;
      streamSocketCloseErrorRef.current = null;
      disposeStreamRuntime({
        cleanupTerminalInteractions,
        fitAddonRef: streamFitAddonRef,
        reconnectTimeoutRef: streamReconnectTimeoutRef,
        resizeObserverRef: streamResizeObserverRef,
        resizeTimeoutRef: streamResizeTimeoutRef,
        scheduleResizeSync,
        serializeAddonRef: streamSerializeAddonRef,
        socketCloseErrorRef: streamSocketCloseErrorRef,
        socketRef: streamSocketRef,
        terminalRef: xtermRef,
      });
      inputListenerRef.current?.dispose();
      inputListenerRef.current = null;
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

  const {
    dotTone: connectionDotTone,
    label: connectionLabel,
    tone: statusTone,
  } = streamConnectionPresentation(connection);

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
  const footer = streamTerminalFooter({
    emptyMessage,
    errorMessage,
    sessionCwd: session?.cwd,
  });

  return (
    <StreamTerminalFrame
      content={
        <div className="min-h-0 flex-1 border border-border/70 bg-[#050708] p-2">
          <div className="h-full min-h-0 w-full" ref={streamContainerRef} />
        </div>
      }
      footer={footer}
      header={{
        dotTone: displayDotTone,
        label: displayLabel,
        onCopyOutput: copyTerminalOutput,
        pid: session?.pid,
        title,
        tone: displayTone,
      }}
      innerClassName="flex h-full min-h-0 w-full flex-col gap-3 p-3"
      outerClassName="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border border-border/70 bg-card"
    />
  );
}
