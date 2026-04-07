import { type Channel, Socket } from "phoenix";
import {
  createServiceChannel,
  createTimingChannel,
  createWorkspaceChannel,
  onServiceChannelMessages,
  onTimingChannelMessages,
  onWorkspaceChannelMessages,
  type ServiceChannel,
  type ServiceChannelHandlers,
  type ServiceChannelRefs,
  type TimingChannel,
  type TimingChannelHandlers,
  type TimingChannelRefs,
  unsubscribeServiceChannel,
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
let rpcChannel: Channel | null = null;
let rpcChannelUrl: string | null = null;
let rpcChannelJoinPromise: Promise<Channel> | null = null;

const PHOENIX_SOCKET_PATH = "/api/cells/terminal/socket";
const ASH_RPC_TOPIC = "ash_typescript_rpc:browser";

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

export function joinServiceRealtimeChannel(options: {
  apiBase: string;
  cellId: string;
  handlers: ServiceChannelHandlers;
  onJoin?: () => void;
  onError?: (reason: unknown) => void;
}): ChannelJoinResult {
  const realtimeSocket = ensureSocket(options.apiBase);
  const channel = createServiceChannel(
    realtimeSocket,
    options.cellId
  ) as ServiceChannel & RealtimeJoinable;
  const refs = onServiceChannelMessages(channel, options.handlers);

  channel
    .join()
    .receive("ok", () => options.onJoin?.())
    .receive("error", (reason: unknown) => options.onError?.(reason));

  return {
    unsubscribe: () => {
      unsubscribeServiceChannel(channel, refs as ServiceChannelRefs);
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
  rpcChannel = null;
  rpcChannelUrl = null;
  rpcChannelJoinPromise = null;
  socket = new Socket(url);
  socket.connect();
  socketUrl = url;
  return socket;
}

export function getAshRpcChannel(apiBase: string): Promise<Channel> {
  const realtimeSocket = ensureSocket(apiBase);
  const url = buildPhoenixSocketUrl(apiBase);

  if (rpcChannel && rpcChannelUrl === url) {
    return Promise.resolve(rpcChannel);
  }

  if (rpcChannelJoinPromise && rpcChannelUrl === url) {
    return rpcChannelJoinPromise;
  }

  rpcChannel = realtimeSocket.channel(ASH_RPC_TOPIC, {});
  rpcChannelUrl = url;
  rpcChannelJoinPromise = new Promise<Channel>((resolve, reject) => {
    rpcChannel
      ?.join()
      .receive("ok", () => {
        if (!rpcChannel) {
          reject(new Error("AshTypescript RPC channel missing after join"));
          return;
        }

        resolve(rpcChannel);
      })
      .receive("error", (reason) => {
        rpcChannel = null;
        rpcChannelJoinPromise = null;
        reject(
          new Error(
            `Failed to join AshTypescript RPC channel: ${JSON.stringify(reason)}`
          )
        );
      });
  });

  return rpcChannelJoinPromise;
}

function buildPhoenixSocketUrl(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = PHOENIX_SOCKET_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
