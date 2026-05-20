import type { Terminal as XTerm } from "@xterm/xterm";
import { Copy } from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
} from "react";
import { toast } from "sonner";
import {
  appendTerminalOutput,
  SOCKET_RECONNECT_DELAY_MS,
  TERMINAL_FONT_FAMILY,
  useTerminalInputBatcher,
} from "@/components/terminal-shared";
import { Button } from "@/components/ui/button";
import {
  copyTextToClipboard,
  registerTerminalClipboard,
} from "@/lib/terminal-clipboard";
import {
  parseTerminalSocketMessage,
  sendTerminalSocketMessage,
} from "@/lib/terminal-websocket";

type SerializeAddonRef = RefObject<{ serialize: () => string } | null>;
type TerminalRef = RefObject<XTerm | null>;
type TimeoutRef = RefObject<number | null>;

type TerminalConnection =
  | "connecting"
  | "idle"
  | "online"
  | "disconnected"
  | "exited";

export type TerminalRuntimeSession = {
  sessionId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  startedAt: string;
};

const RESIZE_DEBOUNCE_MS = 120;
const TERMINAL_DISCONNECTED_MESSAGE =
  "Terminal socket disconnected. Reconnecting…";

export const BASE_TERMINAL_OPTIONS = {
  allowProposedApi: false,
  cols: 120,
  rows: 36,
  convertEol: true,
  cursorBlink: true,
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: 13,
};

type TerminalStatusHeaderProps = {
  title: string;
  label: string;
  tone: string;
  dotTone: string;
  pid?: number | null;
  onCopyOutput: () => void;
  connectionState?: string;
  exitCode?: number | null;
  detail?: string;
  restart?: {
    label: string;
    isPending: boolean;
    onClick: () => void;
  };
};

type TerminalFrameProps = {
  commandBar?: ReactNode;
  content: ReactNode;
  dataAttributes?: Record<string, string | undefined>;
  footer: ReactNode;
  header: TerminalStatusHeaderProps;
  innerClassName: string;
  outerClassName: string;
};

export const terminalConnectionPresentation = (
  connection: TerminalConnection
) => {
  const labelMap: Record<TerminalConnection, string> = {
    online: "Connected",
    connecting: "Connecting",
    idle: "Idle",
    exited: "Exited",
    disconnected: "Disconnected",
  };
  const toneMap: Record<TerminalConnection, string> = {
    online: "text-primary",
    connecting: "text-muted-foreground",
    idle: "text-muted-foreground",
    exited: "text-secondary-foreground",
    disconnected: "text-destructive",
  };
  const dotToneMap: Record<TerminalConnection, string> = {
    online: "bg-[#2DD4BF]",
    connecting: "animate-pulse bg-[#FFC857]",
    idle: "bg-muted-foreground",
    exited: "bg-muted-foreground",
    disconnected: "animate-pulse bg-[#FF5C5C]",
  };

  return {
    dotTone: dotToneMap[connection],
    label: labelMap[connection],
    tone: toneMap[connection],
  };
};

export const useTerminalSocketControls = <
  TSession extends TerminalRuntimeSession,
  TConnection extends TerminalConnection,
>({
  inputEnabled,
  outputRef,
  resizeTimeoutRef,
  serializeAddonRef,
  sessionRef,
  setConnection,
  setErrorMessage,
  setSession,
  shouldResize,
  socketRef,
  terminalRef,
}: {
  inputEnabled: boolean;
  outputRef: RefObject<string>;
  resizeTimeoutRef: TimeoutRef;
  serializeAddonRef: SerializeAddonRef;
  sessionRef?: RefObject<TSession | null>;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setSession: Dispatch<SetStateAction<TSession | null>>;
  shouldResize?: () => boolean;
  socketRef: RefObject<WebSocket | null>;
  terminalRef: TerminalRef;
}) => {
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
  const inputBatcher = useTerminalInputBatcher({
    enabled: inputEnabled,
    sendInputMessage,
  });

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const sent = sendSocketMessage({ type: "resize", cols, rows });
      if (!sent) {
        throw new Error("Terminal socket unavailable");
      }

      setSession((current) => {
        const next = current ? { ...current, cols, rows } : current;
        if (sessionRef) {
          sessionRef.current = next;
        }
        return next;
      });
    },
    [sendSocketMessage, sessionRef, setSession]
  );

  const scheduleResizeSync = useTerminalResizeSync({
    resizeTimeoutRef,
    sendResize,
    shouldResize,
    terminalRef,
  });

  const copyTerminalOutput = useCopyTerminalOutput({
    outputRef,
    serializeAddonRef,
  });

  return {
    copyTerminalOutput,
    flushQueuedInput: inputBatcher.flushQueuedInput,
    resetInputBatcher: inputBatcher.resetInputBatcher,
    scheduleResizeSync,
    sendInput: inputBatcher.sendInput,
    sendSocketMessage,
  };
};

const useCopyTerminalOutput = ({
  outputRef,
  serializeAddonRef,
}: {
  outputRef: RefObject<string>;
  serializeAddonRef: SerializeAddonRef;
}) =>
  useCallback(async () => {
    try {
      const serialized = serializeAddonRef.current?.serialize();
      const text =
        serialized && serialized.length > 0 ? serialized : outputRef.current;
      await copyTextToClipboard(text);
      toast.success("Copied terminal output");
    } catch {
      toast.error("Failed to copy terminal output");
    }
  }, [outputRef, serializeAddonRef]);

const useTerminalSocketSender = <TConnection extends TerminalConnection>({
  setConnection,
  setErrorMessage,
  socketRef,
}: {
  socketRef: RefObject<WebSocket | null>;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
}) =>
  useCallback(
    (message: { type: string; [key: string]: unknown }) => {
      const sent = sendTerminalSocketMessage(socketRef.current, message);
      if (sent) {
        return true;
      }

      setConnection((current) =>
        current === "exited" ? current : ("disconnected" as TConnection)
      );
      setErrorMessage("Terminal socket disconnected. Reconnecting…");
      return false;
    },
    [setConnection, setErrorMessage, socketRef]
  );

export const keepExitedOrOnline = <TConnection extends TerminalConnection>(
  current: TConnection
): TConnection => (current === "exited" ? current : ("online" as TConnection));

const keepExitedOrDisconnected = <TConnection extends TerminalConnection>(
  current: TConnection
): TConnection =>
  current === "exited" ? current : ("disconnected" as TConnection);

export const recoverConnectingConnection = <
  TConnection extends TerminalConnection,
>(
  current: TConnection
): TConnection => {
  if (current === "exited") {
    return current;
  }

  if (current === "connecting") {
    return "online" as TConnection;
  }

  return current;
};

const terminalMessageRecord = (message: unknown): Record<string, unknown> =>
  typeof message === "object" && message !== null
    ? (message as Record<string, unknown>)
    : {};

export const terminalSocketErrorMessage = (message: unknown): string => {
  const record = terminalMessageRecord(message);
  return typeof record.message === "string"
    ? record.message
    : "Terminal socket error";
};

const terminalExitCode = (message: unknown): number => {
  const record = terminalMessageRecord(message);
  return typeof record.exitCode === "number" ? record.exitCode : 0;
};

const terminalSnapshotOutput = (message: unknown): string => {
  const record = terminalMessageRecord(message);
  return typeof record.output === "string" ? record.output : "";
};

const terminalDataChunk = (message: unknown): string => {
  const record = terminalMessageRecord(message);
  return typeof record.chunk === "string" ? record.chunk : "";
};

const useTerminalResizeSync = ({
  resizeTimeoutRef,
  sendResize,
  shouldResize,
  terminalRef,
}: {
  terminalRef: TerminalRef;
  resizeTimeoutRef: TimeoutRef;
  sendResize: (cols: number, rows: number) => void;
  shouldResize?: () => boolean;
}) =>
  useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal || typeof window === "undefined") {
      return;
    }

    if (resizeTimeoutRef.current !== null) {
      window.clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = window.setTimeout(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal || shouldResize?.() === false) {
        return;
      }

      try {
        sendResize(activeTerminal.cols, activeTerminal.rows);
      } catch {
        // ignore transient resize failures while reconnecting
      }
    }, RESIZE_DEBOUNCE_MS);
  }, [resizeTimeoutRef, sendResize, shouldResize, terminalRef]);

const writeTerminalSnapshot = ({
  outputRef,
  snapshot,
  terminal,
}: {
  terminal: XTerm;
  outputRef: RefObject<string>;
  snapshot: string;
}) => {
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

  const previousOutput = outputRef.current;
  outputRef.current = snapshot;
  return previousOutput !== snapshot;
};

const clearTerminalTimers = ({
  reconnectTimeoutRef,
  resizeTimeoutRef,
}: {
  resizeTimeoutRef: TimeoutRef;
  reconnectTimeoutRef: TimeoutRef;
}) => {
  if (resizeTimeoutRef.current !== null) {
    window.clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = null;
  }
  if (reconnectTimeoutRef.current !== null) {
    window.clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }
};

const withCurrentTerminal = <T,>({
  terminalRef,
  run,
}: {
  terminalRef: TerminalRef;
  run: (terminal: XTerm) => T | null;
}) => {
  const terminal = terminalRef.current;
  return terminal ? run(terminal) : null;
};

type TerminalMessageArgs = {
  message: unknown;
  outputRef: RefObject<string>;
  terminalRef: TerminalRef;
};

const writeTerminalMessage = <T,>(
  args: TerminalMessageArgs,
  run: (terminal: XTerm, message: unknown, outputRef: RefObject<string>) => T
) =>
  withCurrentTerminal({
    terminalRef: args.terminalRef,
    run: (terminal) => run(terminal, args.message, args.outputRef),
  });

export const writeTerminalSnapshotMessage = (args: TerminalMessageArgs) =>
  writeTerminalMessage(args, (terminal, message, outputRef) => {
    const snapshot = terminalSnapshotOutput(message);
    const outputChanged = writeTerminalSnapshot({
      outputRef,
      snapshot,
      terminal,
    });
    return { outputChanged, snapshot };
  });

const writeTerminalDataMessage = (args: TerminalMessageArgs) =>
  writeTerminalMessage(args, (terminal, message, outputRef) => {
    const chunk = terminalDataChunk(message);
    if (chunk.length === 0) {
      return null;
    }

    terminal.write(chunk);
    outputRef.current = appendTerminalOutput(outputRef.current, chunk);
    return { chunk, output: outputRef.current };
  });

export const handleTerminalSocketClose = <
  TConnection extends TerminalConnection,
>({
  connectStream,
  isDisposed,
  reconnectTimeoutRef,
  setConnection,
  setErrorMessage,
  socketCloseErrorRef,
  beforeReconnect,
}: {
  connectStream: () => void;
  isDisposed: () => boolean;
  reconnectTimeoutRef: TimeoutRef;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  socketCloseErrorRef: RefObject<string | null>;
  beforeReconnect?: () => void;
}) => {
  if (isDisposed()) {
    return;
  }

  const closeErrorMessage = socketCloseErrorRef.current;
  socketCloseErrorRef.current = null;
  beforeReconnect?.();

  setConnection(keepExitedOrDisconnected);
  setErrorMessage(closeErrorMessage ?? TERMINAL_DISCONNECTED_MESSAGE);

  if (reconnectTimeoutRef.current !== null) {
    return;
  }

  reconnectTimeoutRef.current = window.setTimeout(() => {
    reconnectTimeoutRef.current = null;
    if (!isDisposed()) {
      connectStream();
    }
  }, SOCKET_RECONNECT_DELAY_MS);
};

export const registerTerminalResizeObserver = ({
  container,
  fitAddonRef,
  resizeObserverRef,
  scheduleResizeSync,
}: {
  container: HTMLDivElement;
  fitAddonRef: RefObject<{ fit: () => void } | null>;
  resizeObserverRef: RefObject<ResizeObserver | null>;
  scheduleResizeSync: () => void;
}) => {
  resizeObserverRef.current = new ResizeObserver(() => {
    fitAddonRef.current?.fit();
    scheduleResizeSync();
  });
  resizeObserverRef.current.observe(container);
};

export const registerTerminalSelectionCopy = ({
  canPaste,
  container,
  onKeyDown,
  terminal,
}: {
  canPaste?: boolean;
  container: HTMLElement;
  onKeyDown?: (event: KeyboardEvent) => boolean | undefined;
  terminal: XTerm;
}) =>
  registerTerminalClipboard({
    terminal,
    container,
    canPaste,
    onKeyDown,
    onCopySuccess: () => {
      toast.success("Copied terminal selection");
    },
    onCopyError: () => {
      toast.error("Failed to copy terminal selection");
    },
  });

const reportTerminalInitializationFailure = <
  TConnection extends TerminalConnection,
>({
  error,
  setConnection,
  setErrorMessage,
}: {
  error: unknown;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
}) => {
  setConnection("disconnected" as TConnection);
  setErrorMessage(error instanceof Error ? error.message : "Terminal failed");
};

const parseActiveTerminalSocketMessage = (
  event: MessageEvent,
  isDisposed: () => boolean
) => {
  if (isDisposed()) {
    return null;
  }
  return parseTerminalSocketMessage(event);
};

export const assignTerminalSocketMessageHandler = ({
  isDisposed,
  onMessage,
  socket,
}: {
  isDisposed: () => boolean;
  onMessage: (
    message: NonNullable<ReturnType<typeof parseTerminalSocketMessage>>
  ) => void;
  socket: WebSocket;
}) => {
  socket.onmessage = (event) => {
    const message = parseActiveTerminalSocketMessage(event, isDisposed);
    if (message) {
      onMessage(message);
    }
  };
};

export const loadTerminalBaseModules = () =>
  Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-serialize"),
  ]);

export const syncTerminalSizeFromSession = ({
  cols,
  rows,
  scheduleResizeSync,
  terminalRef,
}: {
  cols: number;
  rows: number;
  scheduleResizeSync: () => void;
  terminalRef: TerminalRef;
}) => {
  const terminal = terminalRef.current;
  if (terminal && (cols !== terminal.cols || rows !== terminal.rows)) {
    scheduleResizeSync();
  }
};

const exitedTerminalSession = <TSession extends TerminalRuntimeSession>(
  current: TSession | null,
  exitCode: number
): TSession | null =>
  current
    ? {
        ...current,
        status: "exited",
        exitCode,
      }
    : current;

export const initializeTerminalInteractions = <
  TConnection extends TerminalConnection,
>({
  initializeTerminal,
  onCleanupReady,
  setConnection,
  setErrorMessage,
}: {
  initializeTerminal: () => Promise<(() => void) | null | undefined>;
  onCleanupReady: (cleanup: (() => void) | null) => void;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
}) => {
  initializeTerminal()
    .then((cleanup) => {
      onCleanupReady(cleanup ?? null);
    })
    .catch((error) => {
      reportTerminalInitializationFailure({
        error,
        setConnection,
        setErrorMessage,
      });
    });
};

export const handleTerminalDataMessage = <
  TConnection extends TerminalConnection,
>({
  afterWrite,
  message,
  outputRef,
  setConnection,
  terminalRef,
}: {
  afterWrite?: (result: { chunk: string; output: string }) => void;
  message: unknown;
  outputRef: RefObject<string>;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  terminalRef: TerminalRef;
}) => {
  const result = writeTerminalDataMessage({ message, outputRef, terminalRef });
  if (!result) {
    return false;
  }
  afterWrite?.(result);
  setConnection(keepExitedOrOnline);
  return true;
};

export const handleTerminalExitMessage = <
  TSession extends TerminalRuntimeSession,
  TConnection extends TerminalConnection,
>({
  afterExit,
  message,
  setConnection,
  setSession,
}: {
  afterExit?: (exitCode: number, session: TSession | null) => void;
  message: unknown;
  setConnection: Dispatch<SetStateAction<TConnection>>;
  setSession: Dispatch<SetStateAction<TSession | null>>;
}) => {
  const exitCode = terminalExitCode(message);
  setConnection("exited" as TConnection);
  setSession((current) => {
    const next = exitedTerminalSession(current, exitCode);
    afterExit?.(exitCode, next);
    return next;
  });
};

export const disposeTerminalRuntime = ({
  cleanupTerminalInteractions,
  fitAddonRef,
  reconnectTimeoutRef,
  resizeObserverRef,
  resizeTimeoutRef,
  scheduleResizeSync,
  serializeAddonRef,
  socketCloseErrorRef,
  socketRef,
  terminalRef,
}: {
  cleanupTerminalInteractions?: (() => void) | null;
  fitAddonRef: RefObject<{ fit: () => void } | null>;
  reconnectTimeoutRef: TimeoutRef;
  resizeObserverRef: RefObject<ResizeObserver | null>;
  resizeTimeoutRef: TimeoutRef;
  scheduleResizeSync: () => void;
  serializeAddonRef: SerializeAddonRef;
  socketCloseErrorRef: RefObject<string | null>;
  socketRef: RefObject<WebSocket | null>;
  terminalRef: TerminalRef;
}) => {
  cleanupTerminalInteractions?.();
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
};

export const terminalFooter = ({
  emptyMessage,
  errorMessage,
  sessionCwd,
}: {
  errorMessage: string | null;
  sessionCwd?: string | null;
  emptyMessage?: string;
}): ReactNode => {
  if (errorMessage) {
    return (
      <p className="text-destructive text-xs uppercase tracking-[0.2em]">
        {errorMessage}
      </p>
    );
  }

  if (sessionCwd) {
    return (
      <p className="truncate text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
        {sessionCwd}
      </p>
    );
  }

  return emptyMessage ? (
    <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em]">
      {emptyMessage}
    </p>
  ) : null;
};

function TerminalStatusHeader({
  connectionState,
  detail,
  dotTone,
  exitCode,
  label,
  onCopyOutput,
  pid,
  restart,
  title,
  tone,
}: TerminalStatusHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="font-semibold text-[11px] text-foreground uppercase tracking-[0.3em]">
          {title}
        </p>
        <span
          className={`text-[11px] uppercase tracking-[0.25em] ${tone}`}
          data-connection-state={connectionState}
          data-exit-code={exitCode === undefined ? undefined : String(exitCode)}
          data-testid={connectionState ? "terminal-connection" : undefined}
        >
          {label}
        </span>
        {pid ? (
          <span className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
            pid {pid}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button
          className="h-7 px-2"
          onClick={onCopyOutput}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {restart ? (
          <Button
            className="h-7 px-2 text-[10px] uppercase tracking-[0.2em]"
            data-testid="terminal-restart-button"
            disabled={restart.isPending}
            onClick={restart.onClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {restart.isPending ? "Restarting" : restart.label}
          </Button>
        ) : null}
        <span
          className="inline-flex h-7 items-center gap-1.5 border border-border/70 px-2 text-[10px] text-muted-foreground uppercase tracking-[0.2em]"
          title={detail}
        >
          <span className={`h-2 w-2 rounded-full ${dotTone}`} />
          {label}
        </span>
      </div>
    </header>
  );
}

export function TerminalFrame({
  commandBar,
  content,
  dataAttributes,
  footer,
  header,
  innerClassName,
  outerClassName,
}: TerminalFrameProps) {
  return (
    <div className={outerClassName} {...dataAttributes}>
      <div className={innerClassName}>
        <TerminalStatusHeader {...header} />
        {commandBar}
        {content}
        {footer}
      </div>
    </div>
  );
}
