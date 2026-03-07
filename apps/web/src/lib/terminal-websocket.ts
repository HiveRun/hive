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

const SOCKET_CONNECTING_STATE = 0;
const SOCKET_OPEN_STATE = 1;
const SOCKET_CLOSING_STATE = 2;
const SOCKET_CLOSED_STATE = 3;

const PHOENIX_HEARTBEAT_INTERVAL_MS = 25_000;
const PHOENIX_SOCKET_PATH = "/api/cells/terminal/socket/websocket";
const PHOENIX_SOCKET_VERSION = "2.0.0";
const PHOENIX_FRAME_MIN_LENGTH = 5;

const SERVICE_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/services\/([^/]+)\/terminal(?:\/(?:stream|ws))?$/;
const SETUP_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/setup\/terminal(?:\/(?:stream|ws))?$/;
const CHAT_TERMINAL_TOPIC_PATTERN =
  /^\/api\/cells\/([^/]+)\/(?:chat\/)?terminal(?:\/(?:stream|ws))?$/;

export const toWebSocketUrl = (value: string): string => {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

export const createTerminalSocket = (options: {
  apiBase: string;
  terminalPath: string;
}): TerminalSocketLike => {
  const topic = resolveTerminalTopic(options.terminalPath);

  if (!topic) {
    const websocketUrl = buildWebSocketUrl(
      options.apiBase,
      options.terminalPath
    );
    return new WebSocket(websocketUrl) as unknown as TerminalSocketLike;
  }

  const phoenixUrl = buildPhoenixSocketUrl(options.apiBase);
  return createPhoenixTerminalSocket({ url: phoenixUrl, topic });
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

const resolveTerminalTopic = (terminalPath: string): string | null => {
  const pathname = extractPathname(terminalPath);

  const serviceMatch = pathname.match(SERVICE_TERMINAL_TOPIC_PATTERN);
  if (serviceMatch) {
    const [, cellId, serviceId] = serviceMatch;
    return `service_terminal:${cellId}:${serviceId}`;
  }

  const setupMatch = pathname.match(SETUP_TERMINAL_TOPIC_PATTERN);
  if (setupMatch) {
    const [, cellId] = setupMatch;
    return `setup_terminal:${cellId}`;
  }

  const chatMatch = pathname.match(CHAT_TERMINAL_TOPIC_PATTERN);
  if (chatMatch) {
    const [, cellId] = chatMatch;
    return `chat_terminal:${cellId}`;
  }

  return null;
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
  url: string;
  topic: string;
}): TerminalSocketLike => {
  const websocket = new WebSocket(options.url);
  const outboundQueue: TerminalSocketMessage[] = [];

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

      sendFrame({
        joinRef,
        ref: nextRef(),
        topic: options.topic,
        event: "terminal_message",
        payload,
      });
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
      topic: options.topic,
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

    if (frame.event === "terminal_event" && frame.topic === options.topic) {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(frame.payload ?? {}),
        })
      );
      return;
    }

    if (frame.topic !== options.topic) {
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

      sendFrame({
        joinRef,
        ref: nextRef(),
        topic: options.topic,
        event: "terminal_message",
        payload,
      });
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
      frame.topic !== options.topic ||
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

  return socket;
};

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
