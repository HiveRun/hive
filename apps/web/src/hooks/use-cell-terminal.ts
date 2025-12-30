import { useCallback, useEffect, useRef, useState } from "react";

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

const resolveWebSocketUrl = (cellId: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(`/api/cells/${cellId}/terminal`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return null;
  }
};

export function useCellTerminal(
  cellId: string,
  options: UseCellTerminalOptions = {}
) {
  const { enabled = true } = options;

  const [status, setStatus] = useState<TerminalConnectionStatus>("idle");
  const [error, setError] = useState<string | undefined>();

  const socketRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef<{
    onOutput?: (event: TerminalOutputEvent) => void;
    onExit?: (event: TerminalExitEvent) => void;
  }>({});

  useEffect(() => {
    callbacksRef.current = {
      onOutput: options.onOutput,
      onExit: options.onExit,
    };
  }, [options.onExit, options.onOutput]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(undefined);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

    if (!cellId) {
      setStatus("idle");
      setError("Missing cellId for terminal");
      return;
    }

    const url = resolveWebSocketUrl(cellId);
    if (!url) {
      setStatus("error");
      setError("Unable to resolve terminal endpoint");
      return;
    }

    let isActive = true;

    setStatus("connecting");
    setError(undefined);

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      if (!isActive) {
        return;
      }
      setStatus("open");
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      if (!isActive) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as
          | {
              type: "output";
              data: string;
              stream: "stdout" | "stderr";
            }
          | { type: "exit"; code: number | null }
          | { type: "error"; message: string };

        if (payload.type === "output") {
          callbacksRef.current.onOutput?.({
            data: payload.data,
            stream: payload.stream,
          });
          return;
        }

        if (payload.type === "exit") {
          callbacksRef.current.onExit?.({ code: payload.code });
          setStatus("closed");
          return;
        }

        if (payload.type === "error") {
          setError(payload.message);
          setStatus("error");
        }
      } catch {
        // Ignore malformed frames
      }
    };

    socket.onerror = () => {
      if (!isActive) {
        return;
      }
      setStatus("error");
      setError("Terminal connection error");
    };

    socket.onclose = () => {
      if (!isActive) {
        return;
      }
      setStatus((previous) => (previous === "closed" ? previous : "closed"));
    };

    return () => {
      isActive = false;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
    };
  }, [cellId, enabled]);

  const sendMessage = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore send errors
    }
  }, []);

  const sendInput = useCallback(
    (data: string) => {
      if (!data) {
        return;
      }
      sendMessage({ type: "input", data });
    },
    [sendMessage]
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      if (!Number.isFinite(cols)) {
        return;
      }
      if (!Number.isFinite(rows)) {
        return;
      }
      sendMessage({ type: "resize", cols, rows });
    },
    [sendMessage]
  );

  const shutdown = useCallback(() => {
    sendMessage({ type: "shutdown" });
  }, [sendMessage]);

  return {
    status,
    error,
    sendInput,
    sendResize,
    shutdown,
  };
}
