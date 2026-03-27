declare module "phoenix" {
  export class Socket {
    constructor(endpoint: string, opts?: Record<string, unknown>);
    connect(): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    channel(topic: string, params?: object): unknown;
  }
}
