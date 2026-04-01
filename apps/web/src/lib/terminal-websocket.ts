import type { Channel } from "phoenix";
import {
  chatTerminalInputChannel,
  chatTerminalResizeChannel,
  chatTerminalRestartChannel,
  serviceTerminalInputChannel,
  serviceTerminalResizeChannel,
  setupTerminalInputChannel,
  setupTerminalResizeChannel,
} from "@/lib/generated/ash-rpc";
import { getAshRpcChannel } from "@/lib/realtime-channels";

export type TerminalSocketMessage = {
  type: string;
  [key: string]: unknown;
};

export type TerminalSocketLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

type PhoenixFrame = [
  string | null,
  string | null,
  string,
  string,
  Record<string, unknown>,
];

type PhoenixFramePayload = {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
};

type TerminalScope =
  | { kind: "terminal"; cellId: string }
  | { kind: "setup"; cellId: string }
  | { kind: "chat"; cellId: string }
  | { kind: "service"; cellId: string; serviceId: string };

const SOCKET_CONNECTING_STATE = 0;
const SOCKET_OPEN_STATE = 1;
const SOCKET_CLOSING_STATE = 2;
const SOCKET_CLOSED_STATE = 3;

const PHOENIX_HEARTBEAT_INTERVAL_MS = 25_000;
const PHOENIX_SOCKET_PATH = "/api/cells/terminal/socket/websocket";
const PHOENIX_SOCKET_VERSION = "2.0.0";
const PHOENIX_FRAME_MIN_LENGTH = 5;
const TERMINAL_CONTROL_FIELDS: "ok"[] = ["ok"];

const SERVICE_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/services\/([^/]+)\/terminal(?:\/(?:stream|ws))?$/;
const SETUP_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/setup\/terminal(?:\/(?:stream|ws))?$/;
const CELL_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/terminal(?:\/(?:stream|ws))?$/;
const CHAT_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/chat\/terminal(?:\/(?:stream|ws))?$/;

export const toWebSocketUrl = (value: string): string => {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

export const createTerminalSocket = (options: {
  apiBase: string;
  terminalPath: string;
}): TerminalSocketLike => {
  const scope = resolveTerminalScope(options.terminalPath);

  if (!scope) {
    const websocketUrl = buildWebSocketUrl(
      options.apiBase,
      options.terminalPath
    );
    return new WebSocket(websocketUrl) as unknown as TerminalSocketLike;
  }

  const phoenixUrl = buildPhoenixSocketUrl(options.apiBase);
  return createPhoenixTerminalSocket({
    apiBase: options.apiBase,
    url: phoenixUrl,
    scope,
  });
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
  socket: TerminalSocketLike | null,
  message: TerminalSocketMessage
): boolean => {
  if (!socket || socket.readyState !== SOCKET_OPEN_STATE) {
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
};

const resolveTerminalScope = (terminalPath: string): TerminalScope | null => {
  const pathname = extractPathname(terminalPath);

  const serviceMatch = pathname.match(SERVICE_TERMINAL_TOPIC_PATTERN);
  if (serviceMatch) {
    const cellId = serviceMatch[1];
    const serviceId = serviceMatch[2];
    if (!(cellId && serviceId)) {
      return null;
    }
    return { kind: "service", cellId, serviceId };
  }

  const setupMatch = pathname.match(SETUP_TERMINAL_TOPIC_PATTERN);
  if (setupMatch) {
    const cellId = setupMatch[1];
    if (!cellId) {
      return null;
    }
    return { kind: "setup", cellId };
  }

  const terminalMatch = pathname.match(CELL_TERMINAL_TOPIC_PATTERN);
  if (terminalMatch) {
    const cellId = terminalMatch[1];
    if (!cellId) {
      return null;
    }
    return { kind: "terminal", cellId };
  }

  const chatMatch = pathname.match(CHAT_TERMINAL_TOPIC_PATTERN);
  if (chatMatch) {
    const cellId = chatMatch[1];
    if (!cellId) {
      return null;
    }
    return { kind: "chat", cellId };
  }

  return null;
};

const topicForScope = (scope: TerminalScope): string => {
  switch (scope.kind) {
    case "terminal":
      return `terminal:${scope.cellId}`;
    case "setup":
      return `setup_terminal:${scope.cellId}`;
    case "chat":
      return `chat_terminal:${scope.cellId}`;
    case "service":
      return `service_terminal:${scope.cellId}:${scope.serviceId}`;
    default:
      return "terminal";
  }
};

const extractPathname = (value: string): string => {
  try {
    return new URL(value).pathname;
  } catch {
    try {
      return new URL(value, "http://localhost").pathname;
    } catch {
      return value.split("?")[0] ?? value;
    }
  }
};

const buildWebSocketUrl = (apiBase: string, terminalPath: string): string =>
  toWebSocketUrl(new URL(terminalPath, apiBase).toString());

const buildPhoenixSocketUrl = (apiBase: string): string => {
  const url = new URL(PHOENIX_SOCKET_PATH, apiBase);
  url.searchParams.set("vsn", PHOENIX_SOCKET_VERSION);
  return toWebSocketUrl(url.toString());
};

const createPhoenixTerminalSocket = (options: {
  apiBase: string;
  url: string;
  scope: TerminalScope;
}): TerminalSocketLike => {
  const websocket = new WebSocket(options.url);
  const outboundQueue: TerminalSocketMessage[] = [];
  const topic = topicForScope(options.scope);

  let socketReadyState = SOCKET_CONNECTING_STATE;
  let heartbeatTimer: number | null = null;
  let refCounter = 1;
  let joinRef: string | null = null;
  let joinRequestRef: string | null = null;
  let joined = false;
  let closed = false;

  const socket: TerminalSocketLike = {
    get readyState() {
      return socketReadyState;
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      let payload: TerminalSocketMessage;
      try {
        payload = JSON.parse(data) as TerminalSocketMessage;
      } catch {
        return;
      }

      if (!isTerminalMessage(payload)) {
        return;
      }

      if (!(joined && socketReadyState === SOCKET_OPEN_STATE)) {
        outboundQueue.push(payload);
        return;
      }

      dispatchControlMessage(payload);
    },
    close(code, reason) {
      if (closed) {
        return;
      }

      socketReadyState = SOCKET_CLOSING_STATE;
      stopHeartbeat();
      closed = true;
      websocket.close(code, reason);
    },
  };

  websocket.onopen = () => {
    joinRef = nextRef();
    joinRequestRef = nextRef();
    sendFrame({
      joinRef,
      ref: joinRequestRef,
      topic,
      event: "phx_join",
      payload: {},
    });
    startHeartbeat();
  };

  websocket.onmessage = (event) => {
    const frame = parsePhoenixFrame(event.data);
    if (!frame) {
      return;
    }

    if (handleJoinReply(frame)) {
      return;
    }

    if (frame.event === "terminal_event" && frame.topic === topic) {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(frame.payload ?? {}),
        })
      );
      return;
    }

    if (frame.topic !== topic) {
      return;
    }

    if (frame.event === "phx_error" || frame.event === "phx_close") {
      socket.onerror?.(new Event("error"));
      socket.close();
    }
  };

  websocket.onerror = (event) => {
    socket.onerror?.(event);
  };

  websocket.onclose = (event) => {
    stopHeartbeat();
    joined = false;
    closed = true;
    socketReadyState = SOCKET_CLOSED_STATE;
    socket.onclose?.(event);
  };

  const nextRef = (): string => {
    const value = String(refCounter);
    refCounter += 1;
    return value;
  };

  const sendFrame = (frame: PhoenixFramePayload): void => {
    if (websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload: PhoenixFrame = [
      frame.joinRef,
      frame.ref,
      frame.topic,
      frame.event,
      frame.payload,
    ];

    websocket.send(JSON.stringify(payload));
  };

  const flushOutboundQueue = (): void => {
    if (!(joined && socketReadyState === SOCKET_OPEN_STATE)) {
      return;
    }

    while (outboundQueue.length > 0) {
      const payload = outboundQueue.shift();
      if (!payload) {
        continue;
      }

      dispatchControlMessage(payload);
    }
  };

  const startHeartbeat = (): void => {
    if (typeof window === "undefined") {
      return;
    }

    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (websocket.readyState !== WebSocket.OPEN) {
        return;
      }

      sendFrame({
        joinRef: null,
        ref: nextRef(),
        topic: "phoenix",
        event: "heartbeat",
        payload: {},
      });
    }, PHOENIX_HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = (): void => {
    if (typeof window === "undefined") {
      return;
    }

    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const handleJoinReply = (frame: PhoenixFramePayload): boolean => {
    if (
      frame.event !== "phx_reply" ||
      frame.topic !== topic ||
      frame.ref !== joinRequestRef ||
      joined
    ) {
      return false;
    }

    if (frame.payload.status === "ok") {
      joined = true;
      socketReadyState = SOCKET_OPEN_STATE;
      flushOutboundQueue();
      socket.onopen?.(new Event("open"));
      return true;
    }

    socket.onerror?.(new Event("error"));
    socket.close();
    return true;
  };

  const dispatchControlMessage = (payload: TerminalSocketMessage): void => {
    if (options.scope.kind === "terminal") {
      if (!(joined && socketReadyState === SOCKET_OPEN_STATE && joinRef)) {
        emitControlError("Terminal socket unavailable");
        return;
      }

      sendFrame({
        joinRef,
        ref: nextRef(),
        topic,
        event: "terminal_message",
        payload,
      });
      return;
    }

    getAshRpcChannel(options.apiBase)
      .then((channel) => {
        switch (payload.type) {
          case "input":
            dispatchTerminalInput(
              channel,
              options.scope,
              payload,
              emitControlError
            );
            break;
          case "resize":
            dispatchTerminalResize(
              channel,
              options.scope,
              payload,
              emitControlError
            );
            break;
          case "restart":
            dispatchTerminalRestart(
              channel,
              options.scope,
              emitControlError,
              () => {
                socket.close();
              }
            );
            break;
          case "ping":
            emitControlEvent({ type: "pong" });
            break;
          default:
            emitControlError("Unsupported message");
        }
      })
      .catch((error: unknown) => {
        emitControlError(
          error instanceof Error
            ? error.message
            : "Terminal control channel unavailable"
        );
      });
  };

  const emitControlEvent = (payload: Record<string, unknown>) => {
    socket.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      })
    );
  };

  const emitControlError = (message: string) => {
    emitControlEvent({ type: "error", message });
  };

  return socket;
};

function dispatchTerminalInput(
  channel: Channel,
  scope: TerminalScope,
  payload: TerminalSocketMessage,
  onError: (message: string) => void
) {
  const data = typeof payload.data === "string" ? payload.data : "";

  if (scope.kind === "setup") {
    setupTerminalInputChannel({
      channel,
      input: { cellId: scope.cellId, data },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(channelErrorMessage(error, "Failed to send setup input")),
      timeoutHandler: () => onError("Setup terminal input timed out"),
    });
    return;
  }

  if (scope.kind === "chat") {
    chatTerminalInputChannel({
      channel,
      input: { cellId: scope.cellId, data },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(channelErrorMessage(error, "Failed to send chat input")),
      timeoutHandler: () => onError("Chat terminal input timed out"),
    });
    return;
  }

  if (scope.kind === "service") {
    serviceTerminalInputChannel({
      channel,
      input: { serviceId: scope.serviceId, data },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(channelErrorMessage(error, "Failed to send service input")),
      timeoutHandler: () => onError("Service terminal input timed out"),
    });
  }
}

function dispatchTerminalResize(
  channel: Channel,
  scope: TerminalScope,
  payload: TerminalSocketMessage,
  onError: (message: string) => void
) {
  const cols =
    typeof payload.cols === "number" ? payload.cols : Number(payload.cols);
  const rows =
    typeof payload.rows === "number" ? payload.rows : Number(payload.rows);

  if (
    !(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0)
  ) {
    onError("cols and rows must be positive integers");
    return;
  }

  if (scope.kind === "setup") {
    setupTerminalResizeChannel({
      channel,
      input: { cellId: scope.cellId, cols, rows },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(channelErrorMessage(error, "Failed to resize setup terminal")),
      timeoutHandler: () => onError("Setup terminal resize timed out"),
    });
    return;
  }

  if (scope.kind === "chat") {
    chatTerminalResizeChannel({
      channel,
      input: { cellId: scope.cellId, cols, rows },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(channelErrorMessage(error, "Failed to resize chat terminal")),
      timeoutHandler: () => onError("Chat terminal resize timed out"),
    });
    return;
  }

  if (scope.kind === "service") {
    serviceTerminalResizeChannel({
      channel,
      input: { serviceId: scope.serviceId, cols, rows },
      fields: TERMINAL_CONTROL_FIELDS,
      resultHandler: noopResult,
      errorHandler: (error: unknown) =>
        onError(
          channelErrorMessage(error, "Failed to resize service terminal")
        ),
      timeoutHandler: () => onError("Service terminal resize timed out"),
    });
  }
}

function dispatchTerminalRestart(
  channel: Channel,
  scope: TerminalScope,
  onError: (message: string) => void,
  onSuccess: () => void
) {
  if (scope.kind !== "chat") {
    onError("Restart is unsupported");
    return;
  }

  chatTerminalRestartChannel({
    channel,
    input: { cellId: scope.cellId },
    fields: TERMINAL_CONTROL_FIELDS,
    resultHandler: () => {
      onSuccess();
    },
    errorHandler: (error: unknown) =>
      onError(channelErrorMessage(error, "Failed to restart chat terminal")),
    timeoutHandler: () => onError("Chat terminal restart timed out"),
  });
}

function noopResult(_result: unknown) {
  return;
}

function channelErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const errorRecord = error as {
      reason?: unknown;
      errors?: Array<{ message?: string }>;
    };

    if (typeof errorRecord.reason === "string") {
      return errorRecord.reason;
    }

    const firstMessage = errorRecord.errors?.[0]?.message;
    if (typeof firstMessage === "string") {
      return firstMessage;
    }
  }

  return fallback;
}

const parsePhoenixFrame = (rawData: unknown): PhoenixFramePayload | null => {
  if (typeof rawData !== "string") {
    return null;
  }

  let frame: unknown;
  try {
    frame = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!Array.isArray(frame) || frame.length < PHOENIX_FRAME_MIN_LENGTH) {
    return null;
  }

  const [joinRef, ref, topic, event, payload] = frame as PhoenixFrame;
  if (!(typeof topic === "string" && typeof event === "string")) {
    return null;
  }

  if (!(payload && typeof payload === "object")) {
    return null;
  }

  return {
    joinRef,
    ref,
    topic,
    event,
    payload,
  };
};

const isTerminalMessage = (
  payload: unknown
): payload is TerminalSocketMessage =>
  Boolean(payload) &&
  typeof payload === "object" &&
  typeof (payload as { type?: unknown }).type === "string";
