import { Socket } from "phoenix";
import {
  createTimingChannel,
  createWorkspaceChannel,
  onTimingChannelMessages,
  onWorkspaceChannelMessages,
  type TimingChannel,
  type TimingChannelHandlers,
  type TimingChannelRefs,
  unsubscribeTimingChannel,
  unsubscribeWorkspaceChannel,
  type WorkspaceChannel,
  type WorkspaceChannelHandlers,
  type WorkspaceChannelRefs,
} from "@/lib/generated/ash-typed-channels";

type RealtimeJoinPush = {
  receive: (
    status: "ok" | "error",
    callback: (payload: unknown) => void
  ) => RealtimeJoinPush;
};

type RealtimeJoinable = {
  join: () => RealtimeJoinPush;
  leave: () => unknown;
};

type ChannelJoinResult = {
  unsubscribe: () => void;
};

let socket: Socket | null = null;
let socketUrl: string | null = null;

const PHOENIX_SOCKET_PATH = "/api/cells/terminal/socket";

export function joinWorkspaceRealtimeChannel(options: {
  apiBase: string;
  workspaceId: string;
  handlers: WorkspaceChannelHandlers;
  onJoin?: () => void;
  onError?: (reason: unknown) => void;
}): ChannelJoinResult {
  const realtimeSocket = ensureSocket(options.apiBase);
  const channel = createWorkspaceChannel(
    realtimeSocket,
    options.workspaceId
  ) as WorkspaceChannel & RealtimeJoinable;
  const refs = onWorkspaceChannelMessages(channel, options.handlers);

  channel
    .join()
    .receive("ok", () => options.onJoin?.())
    .receive("error", (reason: unknown) => options.onError?.(reason));

  return {
    unsubscribe: () => {
      unsubscribeWorkspaceChannel(channel, refs as WorkspaceChannelRefs);
      channel.leave();
    },
  };
}

export function joinTimingRealtimeChannel(options: {
  apiBase: string;
  cellId: string;
  handlers: TimingChannelHandlers;
  onJoin?: () => void;
  onError?: (reason: unknown) => void;
}): ChannelJoinResult {
  const realtimeSocket = ensureSocket(options.apiBase);
  const channel = createTimingChannel(
    realtimeSocket,
    options.cellId
  ) as TimingChannel & RealtimeJoinable;
  const refs = onTimingChannelMessages(channel, options.handlers);

  channel
    .join()
    .receive("ok", () => options.onJoin?.())
    .receive("error", (reason: unknown) => options.onError?.(reason));

  return {
    unsubscribe: () => {
      unsubscribeTimingChannel(channel, refs as TimingChannelRefs);
      channel.leave();
    },
  };
}

function ensureSocket(apiBase: string): Socket {
  const url = buildPhoenixSocketUrl(apiBase);

  if (socket && socketUrl === url) {
    return socket;
  }

  socket?.disconnect();
  socket = new Socket(url);
  socket.connect();
  socketUrl = url;
  return socket;
}

function buildPhoenixSocketUrl(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = PHOENIX_SOCKET_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
