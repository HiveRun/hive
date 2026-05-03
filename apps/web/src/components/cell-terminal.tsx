import "@xterm/xterm/css/xterm.css";

import type { Terminal as XTerm } from "@xterm/xterm";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { Button } from "@/components/ui/button";
import {
  copyTextToClipboard,
  registerTerminalClipboard,
} from "@/lib/terminal-clipboard";
import {
  parseTerminalSocketMessage,
  toWebSocketUrl,
} from "@/lib/terminal-websocket";

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

const WHEEL_LINE_UP_SEQUENCE = "\u001b\u0019";
const WHEEL_LINE_DOWN_SEQUENCE = "\u001b\u0005";
const TERMINAL_SCROLLBACK_LINES = 10_000;
const KEY_SCROLLED_TERMINAL_SCROLLBACK_LINES = 0;
const STARTUP_VISIBLE_BUFFER_LIMIT = 8192;
const STARTUP_FALLBACK_VISIBLE_LENGTH = 48;
const STARTUP_FALLBACK_READY_DELAY_MS = 2500;
const ASCII_NULL_CODE = 0x00;
const ASCII_ESCAPE_CODE = 0x1b;
const ASCII_BELL_CODE = 0x07;
const ASCII_BACKSPACE_CODE = 0x08;
const ASCII_VERTICAL_TAB_CODE = 0x0b;
const ASCII_SUBSTITUTE_CODE = 0x1a;
const ASCII_FILE_SEPARATOR_CODE = 0x1c;
const ASCII_SPACE_CODE = 0x20;
const ASCII_DELETE_CODE = 0x7f;
const CSI_FINAL_BYTE_START = 0x40;
const CSI_FINAL_BYTE_END = 0x7e;
const CSI_MARKER = "[";
const OSC_MARKER = "]";
const OSC_ESCAPE_TERMINATOR = "\\";
const NON_WHITESPACE_RE = /\S/;
const TERMINAL_THEME_DARK = {
  background: "#070504",
  foreground: "#F4E6CD",
  cursor: "#F5A524",
  cursorAccent: "#070504",
  black: "#070504",
  brightBlack: "#8A7A63",
  red: "#FF5C5C",
  brightRed: "#FF8F1F",
  green: "#8EDB5D",
  brightGreen: "#B4F28B",
  yellow: "#FFC857",
  brightYellow: "#FFE9A8",
  blue: "#A35D11",
  brightBlue: "#D4862B",
  magenta: "#FF8F1F",
  brightMagenta: "#FFC857",
  cyan: "#C18B2F",
  brightCyan: "#E3B157",
  white: "#E8DCC4",
  brightWhite: "#FFFFFF",
};

const TERMINAL_THEME_LIGHT = {
  background: "#F6F1E6",
  foreground: "#2B2520",
  cursor: "#A35D11",
  cursorAccent: "#F6F1E6",
  black: "#2B2520",
  brightBlack: "#6B6156",
  red: "#B93D3D",
  brightRed: "#D04A3C",
  green: "#2F7D4A",
  brightGreen: "#4F9C63",
  yellow: "#A35D11",
  brightYellow: "#C5771E",
  blue: "#8E5A16",
  brightBlue: "#AF7422",
  magenta: "#A35D11",
  brightMagenta: "#C5771E",
  cyan: "#8C6E2A",
  brightCyan: "#A8863B",
  white: "#F1E7D5",
  brightWhite: "#FBF7EE",
};

const skipCsiSequence = (value: string, startIndex: number): number => {
  let index = startIndex;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= CSI_FINAL_BYTE_START && code <= CSI_FINAL_BYTE_END) {
      return index;
    }
  }
  return index;
};

const skipOscSequence = (value: string, startIndex: number): number => {
  let index = startIndex;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ASCII_BELL_CODE) {
      return index + 1;
    }
    if (
      code === ASCII_ESCAPE_CODE &&
      value[index + 1] === OSC_ESCAPE_TERMINATOR
    ) {
      return index + 2;
    }
    index += 1;
  }
  return index;
};

const isFilteredControlCode = (code: number): boolean =>
  (code >= ASCII_NULL_CODE && code <= ASCII_BACKSPACE_CODE) ||
  (code >= ASCII_VERTICAL_TAB_CODE && code <= ASCII_SUBSTITUTE_CODE) ||
  (code >= ASCII_FILE_SEPARATOR_CODE && code < ASCII_SPACE_CODE) ||
  code === ASCII_DELETE_CODE;

const extractVisibleText = (value: string): string => {
  let output = "";
  let index = 0;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ASCII_ESCAPE_CODE) {
      const marker = value[index + 1];
      if (marker === CSI_MARKER) {
        index = skipCsiSequence(value, index + 2);
        continue;
      }
      if (marker === OSC_MARKER) {
        index = skipOscSequence(value, index + 2);
        continue;
      }
      index += 2;
      continue;
    }

    if (isFilteredControlCode(code)) {
      index += 1;
      continue;
    }

    output += value[index];
    index += 1;
  }

  return output;
};

const appendVisibleBuffer = (current: string, chunk: string): string => {
  const next = `${current}${extractVisibleText(chunk)}`;
  if (next.length <= STARTUP_VISIBLE_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - STARTUP_VISIBLE_BUFFER_LIMIT);
};

function createWheelBridge(
  target: HTMLElement,
  wheelScrollBehavior: "terminal" | "line-keys",
  sendInput: (data: string) => void
): () => void {
  const handleWheel = (event: WheelEvent) => {
    if (wheelScrollBehavior === "terminal") {
      return;
    }

    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const direction = Math.sign(event.deltaY);
    if (direction === 0) {
      return;
    }

    sendInput(
      direction < 0 ? WHEEL_LINE_UP_SEQUENCE : WHEEL_LINE_DOWN_SEQUENCE
    );
  };

  target.addEventListener("wheel", handleWheel, {
    capture: true,
    passive: false,
  });

  return () => {
    target.removeEventListener("wheel", handleWheel, true);
  };
}

type CellTerminalProps = {
  cellId: string;
  endpointBase?: string;
  title?: string;
  restartLabel?: string;
  reconnectLabel?: string;
  connectCommand?: string | null;
  terminalLineHeight?: number;
  wheelScrollBehavior?: "terminal" | "line-keys";
  themeMode?: "dark" | "light";
  startupReadiness?: "session" | "terminal-content";
  startupTextMatch?: string | null;
  startupStatusMessage?: string | null;
  startupOverlay?: ReactNode;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Terminal lifecycle handling intentionally coordinates stream events, reconnects, and UI status in one component.
export function CellTerminal({
  cellId,
  endpointBase = "terminal",
  title = "Cell Terminal",
  restartLabel = "Restart shell",
  reconnectLabel = "Reconnect",
  connectCommand = null,
  terminalLineHeight = 1.25,
  wheelScrollBehavior = "terminal",
  themeMode = "dark",
  startupReadiness = "session",
  startupTextMatch = null,
  startupStatusMessage = null,
  startupOverlay = null,
}: CellTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const serializeAddonRef = useRef<{ serialize: () => string } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const outputRef = useRef<string>("");
  const visibleOutputRef = useRef<string>("");
  const restartPendingRef = useRef(false);
  const socketCloseErrorRef = useRef<string | null>(null);
  const resizeTimeoutRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isTerminalInitialized, setIsTerminalInitialized] = useState(false);
  const [terminalOutputSeq, setTerminalOutputSeq] = useState(0);
  const [terminalOutputLength, setTerminalOutputLength] = useState(0);
  const [terminalVisibleOutputLength, setTerminalVisibleOutputLength] =
    useState(0);
  const [terminalOutputUpdatedAt, setTerminalOutputUpdatedAt] = useState(0);
  const [isStartupReady, setIsStartupReady] = useState(
    startupReadiness === "session"
  );
  const terminalApiBase = `${API_BASE}/api/cells/${cellId}/${endpointBase}`;
  const normalizedStartupMatch = startupTextMatch?.trim().toLowerCase() ?? "";

  const updateStartupReadiness = useCallback(
    (visibleOutput: string) => {
      if (startupReadiness === "session") {
        return;
      }
      if (!NON_WHITESPACE_RE.test(visibleOutput)) {
        return;
      }

      if (normalizedStartupMatch.length > 0) {
        const normalizedVisibleOutput = visibleOutput.toLowerCase();
        if (
          !normalizedVisibleOutput.includes(normalizedStartupMatch) &&
          normalizedVisibleOutput.trim().length <
            STARTUP_FALLBACK_VISIBLE_LENGTH
        ) {
          return;
        }
        setIsStartupReady(true);
        return;
      }
      setIsStartupReady(true);
    },
    [normalizedStartupMatch, startupReadiness]
  );
  const buildTerminalEndpoint = useCallback(
    (path: string) => `${terminalApiBase}/${path}?themeMode=${themeMode}`,
    [terminalApiBase, themeMode]
  );

  const buildTerminalSocketEndpoint = useCallback(
    () => toWebSocketUrl(buildTerminalEndpoint("ws")),
    [buildTerminalEndpoint]
  );

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
  const { flushQueuedInput, resetInputBatcher, sendInput } =
    useTerminalInputBatcher({
      enabled: true,
      sendInputMessage,
    });

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const sent = sendSocketMessage({ type: "resize", cols, rows });
      if (!sent) {
        throw new Error("Terminal socket unavailable");
      }

      setSession((current) =>
        current
          ? {
              ...current,
              cols,
              rows,
            }
          : current
      );
    },
    [sendSocketMessage]
  );

  const scheduleResizeSync = useTerminalResizeSync({
    resizeTimeoutRef,
    sendResize,
    terminalRef,
  });

  const recordOutputActivity = useCallback((nextOutput: string) => {
    setTerminalOutputSeq((current) => current + 1);
    setTerminalOutputLength(nextOutput.length);
    setTerminalOutputUpdatedAt(Date.now());
  }, []);

  const copyTerminalOutput = useCopyTerminalOutput({
    outputRef,
    serializeAddonRef,
  });

  const copyConnectCommand = useCallback(async () => {
    if (!connectCommand) {
      return;
    }

    try {
      await copyTextToClipboard(connectCommand);
      toast.success("Copied connect command");
    } catch {
      toast.error("Failed to copy connect command");
    }
  }, [connectCommand]);

  const restartTerminal = useCallback(() => {
    flushQueuedInput();
    const sent = sendSocketMessage({ type: "restart" });
    if (!sent) {
      setConnection("disconnected");
      toast.error("Failed to restart terminal");
      return;
    }

    restartPendingRef.current = true;
    setIsRestarting(true);
    setConnection("connecting");
    setSession(null);
    setErrorMessage(null);
    socketCloseErrorRef.current = null;
    visibleOutputRef.current = "";
    setTerminalVisibleOutputLength(0);
    setIsStartupReady(startupReadiness === "session");
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.write("\x1bc");
    }
    fitAddonRef.current?.fit();
    outputRef.current = "";
  }, [flushQueuedInput, sendSocketMessage, startupReadiness]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let disposed = false;
    outputRef.current = "";
    visibleOutputRef.current = "";
    setSession(null);
    setConnection("connecting");
    setErrorMessage(null);
    setIsTerminalInitialized(false);
    setTerminalOutputSeq(0);
    setTerminalOutputLength(0);
    setTerminalVisibleOutputLength(0);
    setTerminalOutputUpdatedAt(0);
    setIsStartupReady(startupReadiness === "session");

    const connectStream = () => {
      const socket = new WebSocket(buildTerminalSocketEndpoint());
      socketRef.current = socket;
      socketCloseErrorRef.current = null;

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: message handling needs full event-state matrix for terminal sync.
      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        const message = parseTerminalSocketMessage(event);
        if (!message) {
          return;
        }

        if (message.type === "ready") {
          const payload = (message.session ?? null) as TerminalSession | null;
          if (!payload) {
            return;
          }
          setSession(payload);
          setConnection(payload.status === "exited" ? "exited" : "online");
          setErrorMessage(null);
          socketCloseErrorRef.current = null;
          if (startupReadiness === "session") {
            setIsStartupReady(true);
          }
          if (restartPendingRef.current) {
            restartPendingRef.current = false;
            setIsRestarting(false);
            toast.success("Terminal restarted");
          }
          const activeTerminal = terminalRef.current;
          if (
            activeTerminal &&
            (payload.cols !== activeTerminal.cols ||
              payload.rows !== activeTerminal.rows)
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
          const outputChanged = writeTerminalSnapshot({
            outputRef,
            snapshot,
            terminal,
          });
          if (outputChanged) {
            recordOutputActivity(snapshot);
          }
          visibleOutputRef.current = extractVisibleText(snapshot).slice(
            -STARTUP_VISIBLE_BUFFER_LIMIT
          );
          setTerminalVisibleOutputLength(visibleOutputRef.current.length);
          updateStartupReadiness(visibleOutputRef.current);
          scheduleResizeSync();
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
          visibleOutputRef.current = appendVisibleBuffer(
            visibleOutputRef.current,
            chunk
          );
          setTerminalVisibleOutputLength(visibleOutputRef.current.length);
          updateStartupReadiness(visibleOutputRef.current);
          recordOutputActivity(outputRef.current);
          setConnection(keepExitedOrOnline);
          return;
        }

        if (message.type === "exit") {
          const exitCode = terminalExitCode(message);
          setConnection("exited");
          setSession((current) =>
            current
              ? {
                  ...current,
                  status: "exited",
                  exitCode,
                }
              : current
          );
          return;
        }

        if (message.type === "error") {
          const description = terminalSocketErrorMessage(message);
          if (restartPendingRef.current) {
            restartPendingRef.current = false;
            setIsRestarting(false);
            toast.error(description);
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

        if (restartPendingRef.current) {
          restartPendingRef.current = false;
          setIsRestarting(false);
          toast.error("Terminal restart interrupted");
        }

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
      const [
        { Terminal },
        { FitAddon },
        { SerializeAddon },
        { WebLinksAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-serialize"),
        import("@xterm/addon-web-links"),
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
        lineHeight: terminalLineHeight,
        scrollback:
          wheelScrollBehavior === "line-keys"
            ? KEY_SCROLLED_TERMINAL_SCROLLBACK_LINES
            : TERMINAL_SCROLLBACK_LINES,
        theme:
          themeMode === "light" ? TERMINAL_THEME_LIGHT : TERMINAL_THEME_DARK,
      });

      const fitAddon = new FitAddon();
      const serializeAddon = new SerializeAddon();
      const webLinksAddon = new WebLinksAddon(
        (event: MouseEvent, uri: string) => {
          event.preventDefault();
          window.open(uri, "_blank", "noopener,noreferrer");
        }
      );

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(serializeAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminal.focus();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      serializeAddonRef.current = serializeAddon;
      setIsTerminalInitialized(true);

      terminal.onData((data) => {
        sendInput(data);
      });

      resizeObserverRef.current = new ResizeObserver(() => {
        fitAddonRef.current?.fit();
        scheduleResizeSync();
      });
      resizeObserverRef.current.observe(containerRef.current);

      const cleanupWheelBridge = createWheelBridge(
        containerRef.current,
        wheelScrollBehavior,
        sendInput
      );
      const cleanupClipboard = registerTerminalClipboard({
        terminal,
        container: containerRef.current,
        onCopySuccess: () => {
          toast.success("Copied terminal selection");
        },
        onCopyError: () => {
          toast.error("Failed to copy terminal selection");
        },
      });

      window.addEventListener("resize", scheduleResizeSync);
      connectStream();
      scheduleResizeSync();

      return () => {
        cleanupClipboard();
        cleanupWheelBridge();
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
      restartPendingRef.current = false;
      socketCloseErrorRef.current = null;
      clearTerminalTimers({ reconnectTimeoutRef, resizeTimeoutRef });
      window.removeEventListener("resize", scheduleResizeSync);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
      setIsTerminalInitialized(false);
    };
  }, [
    buildTerminalSocketEndpoint,
    resetInputBatcher,
    scheduleResizeSync,
    sendInput,
    themeMode,
    terminalLineHeight,
    startupReadiness,
    updateStartupReadiness,
    wheelScrollBehavior,
    recordOutputActivity,
  ]);

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
    online: `${title} stream connected`,
    connecting: `Connecting to ${title.toLowerCase()} stream`,
    exited: `${title} exited. Restart to reconnect`,
    disconnected: `${title} stream disconnected. Reconnecting`,
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
  const restartActionLabel =
    connection === "disconnected" ? reconnectLabel : restartLabel;
  const terminalFrameTone =
    themeMode === "light" ? "bg-[#EDE3CD]" : "bg-[#070504]";
  const loadingPanelTone =
    themeMode === "light"
      ? "bg-[#F3EAD7]/90 border-[#C7BDA6]/70"
      : "bg-[#111416]/80 border-border/70";
  const loadingLabelTone =
    themeMode === "light" ? "text-[#7A5C2A]" : "text-[#FFC857]";
  const loadingBackdropTone =
    themeMode === "light" ? "bg-[#F6F1E6]/96" : "bg-[#070504]/94";
  const showLoadingOverlay =
    !isStartupReady && connection !== "disconnected" && connection !== "exited";
  const startupMessage =
    startupStatusMessage?.trim() || "Starting OpenCode session";
  const terminalReady =
    isTerminalInitialized &&
    isStartupReady &&
    connection === "online" &&
    session?.status === "running";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (
      startupReadiness !== "terminal-content" ||
      isStartupReady ||
      connection !== "online"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsStartupReady(true);
    }, STARTUP_FALLBACK_READY_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [connection, isStartupReady, startupReadiness]);

  const footer = terminalFooter({
    errorMessage,
    sessionCwd: session?.cwd,
  });

  return (
    <div
      className="flex h-full min-h-0 flex-1 overflow-hidden rounded-sm border-2 border-border bg-card"
      data-terminal-error-message={errorMessage ?? ""}
      data-terminal-output-length={String(terminalOutputLength)}
      data-terminal-output-seq={String(terminalOutputSeq)}
      data-terminal-output-updated-at={String(terminalOutputUpdatedAt)}
      data-terminal-ready={terminalReady ? "true" : "false"}
      data-terminal-visible-output-length={String(terminalVisibleOutputLength)}
      data-testid="cell-terminal"
    >
      <div className="flex h-full min-h-0 w-full flex-col gap-3 p-4">
        <TerminalStatusHeader
          connectionState={connection}
          detail={connectionDetail}
          dotTone={connectionDotTone}
          exitCode={connection === "exited" ? session?.exitCode : undefined}
          label={connectionLabel}
          onCopyOutput={copyTerminalOutput}
          pid={session?.pid}
          restart={{
            isPending: isRestarting,
            label: restartActionLabel,
            onClick: restartTerminal,
          }}
          title={title}
          tone={statusTone}
        />

        {connectCommand ? (
          <div className="flex items-center justify-between gap-2 border border-border/70 bg-background/60 px-2 py-1.5">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {connectCommand}
            </p>
            <Button
              className="h-6 px-2 text-[10px] uppercase tracking-[0.2em]"
              onClick={copyConnectCommand}
              size="sm"
              type="button"
              variant="secondary"
            >
              Copy command
            </Button>
          </div>
        ) : null}

        <div
          className={`relative min-h-0 flex-1 border border-border/70 p-2 ${terminalFrameTone}`}
        >
          <div
            className={`h-full min-h-0 w-full ${showLoadingOverlay ? "opacity-0" : "opacity-100"}`}
            data-testid="cell-terminal-input"
            ref={containerRef}
          />
          {showLoadingOverlay ? (
            <div
              className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${loadingBackdropTone}`}
            >
              {startupOverlay ? (
                startupOverlay
              ) : (
                <div
                  className={`flex items-center gap-2 border px-3 py-2 text-[11px] uppercase tracking-[0.24em] ${loadingPanelTone} ${loadingLabelTone}`}
                >
                  <span className="h-2 w-2 animate-pulse bg-current" />
                  {startupMessage}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {footer}
      </div>
    </div>
  );
}
