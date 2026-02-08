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
const WHEEL_LINE_UP_SEQUENCE = "\u001b\u0019";
const WHEEL_LINE_DOWN_SEQUENCE = "\u001b\u0005";
const TERMINAL_SCROLLBACK_LINES = 10_000;
const KEY_SCROLLED_TERMINAL_SCROLLBACK_LINES = 0;
const STARTUP_VISIBLE_BUFFER_LIMIT = 8192;
const STARTUP_FALLBACK_VISIBLE_LENGTH = 48;
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
const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "MesloLGS NF", "CaskaydiaMono Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", "Geist Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Noto Color Emoji", monospace';
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

const appendOutput = (current: string, chunk: string): string => {
  const next = `${current}${chunk}`;
  if (next.length <= OUTPUT_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
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
};

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
}: CellTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const serializeAddonRef = useRef<{ serialize: () => string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const outputRef = useRef<string>("");
  const visibleOutputRef = useRef<string>("");
  const resizeTimeoutRef = useRef<number | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
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

  const sendResize = useCallback(
    async (cols: number, rows: number) => {
      const response = await fetch(buildTerminalEndpoint("resize"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cols, rows }),
      });

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
    [buildTerminalEndpoint]
  );

  const sendInput = useCallback(
    (data: string) => {
      fetch(buildTerminalEndpoint("input"), {
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
    [buildTerminalEndpoint]
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

  const copyConnectCommand = useCallback(async () => {
    if (!connectCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(connectCommand);
      toast.success("Copied connect command");
    } catch {
      toast.error("Failed to copy connect command");
    }
  }, [connectCommand]);

  const restartTerminal = useCallback(async () => {
    setIsRestarting(true);
    setConnection("connecting");
    setSession(null);
    setErrorMessage(null);
    visibleOutputRef.current = "";
    setIsStartupReady(startupReadiness === "session");
    try {
      const response = await fetch(buildTerminalEndpoint("restart"), {
        method: "POST",
      });
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
      fitAddonRef.current?.fit();
      scheduleResizeSync();
      outputRef.current = "";
      toast.success("Terminal restarted");
    } catch {
      setConnection("disconnected");
      toast.error("Failed to restart terminal");
    } finally {
      setIsRestarting(false);
    }
  }, [buildTerminalEndpoint, scheduleResizeSync, startupReadiness]);

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
    setIsStartupReady(startupReadiness === "session");

    const connectStream = () => {
      const source = new EventSource(buildTerminalEndpoint("stream"));
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
        if (startupReadiness === "session") {
          setIsStartupReady(true);
        }
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
        visibleOutputRef.current = extractVisibleText(snapshot).slice(
          -STARTUP_VISIBLE_BUFFER_LIMIT
        );
        updateStartupReadiness(visibleOutputRef.current);
        scheduleResizeSync();
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
        visibleOutputRef.current = appendVisibleBuffer(
          visibleOutputRef.current,
          chunk
        );
        updateStartupReadiness(visibleOutputRef.current);
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

      const cleanupWheelBridge = createWheelBridge(
        containerRef.current,
        wheelScrollBehavior,
        sendInput
      );

      window.addEventListener("resize", scheduleResizeSync);
      connectStream();
      scheduleResizeSync();

      return () => {
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
  }, [
    buildTerminalEndpoint,
    scheduleResizeSync,
    sendInput,
    themeMode,
    terminalLineHeight,
    startupReadiness,
    updateStartupReadiness,
    wheelScrollBehavior,
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
              {title}
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
              {isRestarting ? "Restarting" : restartActionLabel}
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
            ref={containerRef}
          />
          {showLoadingOverlay ? (
            <div
              className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${loadingBackdropTone}`}
            >
              <div
                className={`flex items-center gap-2 border px-3 py-2 text-[11px] uppercase tracking-[0.24em] ${loadingPanelTone} ${loadingLabelTone}`}
              >
                <span className="h-2 w-2 animate-pulse bg-current" />
                Starting OpenCode session
              </div>
            </div>
          ) : null}
        </div>

        {footer}
      </div>
    </div>
  );
}
