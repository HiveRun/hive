declare module "phoenix" {
  export type Push = {
    receive: (
      status: "ok" | "error" | "timeout",
      callback: (payload: unknown) => void
    ) => Push;
  };

  export class Channel {
    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    push(event: string, payload: unknown, timeout?: number): Push;
    on(event: string, callback: (payload: unknown) => void): number;
    off(event: string, ref?: number): void;
  }

  export class Socket {
    constructor(endpoint: string, opts?: Record<string, unknown>);
    connect(): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    channel(topic: string, params?: object): Channel;
  }
}
