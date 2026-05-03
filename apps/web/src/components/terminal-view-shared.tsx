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
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/terminal-clipboard";
import { sendTerminalSocketMessage } from "@/lib/terminal-websocket";

type SerializeAddonRef = RefObject<{ serialize: () => string } | null>;
type TerminalRef = RefObject<XTerm | null>;
type TimeoutRef = RefObject<number | null>;

type TerminalConnection =
  | "connecting"
  | "idle"
  | "online"
  | "disconnected"
  | "exited";

const RESIZE_DEBOUNCE_MS = 120;

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

export const useCopyTerminalOutput = ({
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

export const useTerminalSocketSender = <
  TConnection extends TerminalConnection,
>({
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

export const keepExitedOrDisconnected = <
  TConnection extends TerminalConnection,
>(
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

export const terminalExitCode = (message: unknown): number => {
  const record = terminalMessageRecord(message);
  return typeof record.exitCode === "number" ? record.exitCode : 0;
};

export const terminalSnapshotOutput = (message: unknown): string => {
  const record = terminalMessageRecord(message);
  return typeof record.output === "string" ? record.output : "";
};

export const terminalDataChunk = (message: unknown): string => {
  const record = terminalMessageRecord(message);
  return typeof record.chunk === "string" ? record.chunk : "";
};

export const useTerminalResizeSync = ({
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

export const writeTerminalSnapshot = ({
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

export const clearTerminalTimers = ({
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

export function TerminalStatusHeader({
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
