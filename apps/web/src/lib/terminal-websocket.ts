export type TerminalSocketMessage = {
  type: string;
  [key: string]: unknown;
};

export const toWebSocketUrl = (value: string): string => {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

export const parseTerminalSocketMessage = (
  event: MessageEvent<string>
): TerminalSocketMessage | null => {
  if (typeof event.data !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(event.data) as unknown;
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const message = payload as { type?: unknown };
    if (typeof message.type !== "string") {
      return null;
    }

    return payload as TerminalSocketMessage;
  } catch {
    return null;
  }
};

export const sendTerminalSocketMessage = (
  socket: WebSocket | null,
  message: TerminalSocketMessage
): boolean => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
};
