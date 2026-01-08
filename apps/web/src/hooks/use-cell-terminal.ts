export type TerminalConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type TerminalOutputEvent = {
  data: string;
  stream: "stdout" | "stderr";
};

export type TerminalExitEvent = {
  code: number | null;
};

export type UseCellTerminalOptions = {
  enabled?: boolean;
  onOutput?: (event: TerminalOutputEvent) => void;
  onExit?: (event: TerminalExitEvent) => void;
};

export function useCellTerminal(
  _cellId: string,
  options: UseCellTerminalOptions = {}
) {
  const { onOutput, onExit } = options;

  // Immediately surface a clear, deterministic message so that any callers
  // do not hang waiting for a connection that will never succeed.
  onOutput?.({
    data: "Cell terminal is disabled in this build. Remove terminal usage or update Hive to a version with terminal support.\n",
    stream: "stderr",
  });
  onExit?.({ code: null });

  return {
    status: "error" as TerminalConnectionStatus,
    error: "Cell terminal is disabled in this build.",
    sendInput: (_data: string) => {
      // no-op
    },
    sendResize: (_cols: number, _rows: number) => {
      // no-op
    },
    shutdown: () => {
      // no-op
    },
  };
}
