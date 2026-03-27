import type { TimingChannel, TimingChannelEvents, TimingChannelHandlers, TimingChannelRefs, WorkspaceChannel, WorkspaceChannelEvents, WorkspaceChannelHandlers, WorkspaceChannelRefs } from "./ash_types";
export type * from "./ash_types";

export function createTimingChannel(
  socket: { channel(topic: string, params?: object): unknown },
  suffix: string
): TimingChannel {
  return socket.channel(`timings:${suffix}`) as TimingChannel;
}

export function onTimingChannelMessage<E extends keyof TimingChannelEvents>(
  channel: TimingChannel,
  event: E,
  handler: (payload: TimingChannelEvents[E]) => void
): number {
  return channel.on(event, (payload: unknown) => handler(payload as TimingChannelEvents[E]));
}

export function onTimingChannelMessages(
  channel: TimingChannel,
  handlers: TimingChannelHandlers
): TimingChannelRefs {
  const refs: TimingChannelRefs = {};
  for (const event in handlers) {
    const e = event as keyof TimingChannelEvents;
    const handler = handlers[e];
    if (handler) {
      refs[e] = channel.on(event, (payload) => (handler as (p: unknown) => void)(payload));
    }
  }
  return refs;
}

export function unsubscribeTimingChannel(
  channel: TimingChannel,
  refs: TimingChannelRefs
): void {
  for (const event in refs) {
    const e = event as keyof TimingChannelRefs;
    const ref = refs[e];
    if (ref !== undefined) {
      channel.off(event, ref);
    }
  }
}

export function createWorkspaceChannel(
  socket: { channel(topic: string, params?: object): unknown },
  suffix: string
): WorkspaceChannel {
  return socket.channel(`workspace:${suffix}`) as WorkspaceChannel;
}

export function onWorkspaceChannelMessage<E extends keyof WorkspaceChannelEvents>(
  channel: WorkspaceChannel,
  event: E,
  handler: (payload: WorkspaceChannelEvents[E]) => void
): number {
  return channel.on(event, (payload: unknown) => handler(payload as WorkspaceChannelEvents[E]));
}

export function onWorkspaceChannelMessages(
  channel: WorkspaceChannel,
  handlers: WorkspaceChannelHandlers
): WorkspaceChannelRefs {
  const refs: WorkspaceChannelRefs = {};
  for (const event in handlers) {
    const e = event as keyof WorkspaceChannelEvents;
    const handler = handlers[e];
    if (handler) {
      refs[e] = channel.on(event, (payload) => (handler as (p: unknown) => void)(payload));
    }
  }
  return refs;
}

export function unsubscribeWorkspaceChannel(
  channel: WorkspaceChannel,
  refs: WorkspaceChannelRefs
): void {
  for (const event in refs) {
    const e = event as keyof WorkspaceChannelRefs;
    const ref = refs[e];
    if (ref !== undefined) {
      channel.off(event, ref);
    }
  }
}