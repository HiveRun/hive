import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import type { Cell } from "@/queries/cells";

export type MockEventSourceInstance = {
  url: string;
  closed: boolean;
  addEventListener: (
    event: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener: (
    event: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  close: () => void;
  emit: (event: string, data?: string) => void;
  onerror: (() => void) | null;
};

export function createEventSourceMock() {
  const instances: MockEventSourceInstance[] = [];

  function MockEventSource(url: string): MockEventSourceInstance {
    const listeners = new Map<
      string,
      Set<EventListenerOrEventListenerObject>
    >();

    const instance: MockEventSourceInstance = {
      url,
      closed: false,
      addEventListener(event, listener) {
        const existing = listeners.get(event) ?? new Set();
        existing.add(listener);
        listeners.set(event, existing);
      },
      removeEventListener(event, listener) {
        listeners.get(event)?.delete(listener);
      },
      close() {
        instance.closed = true;
      },
      emit(event, data = "{}") {
        const registered = listeners.get(event);
        if (!registered) {
          return;
        }

        const message = new MessageEvent(event, { data });
        for (const listener of registered) {
          if (typeof listener === "function") {
            listener(message);
            continue;
          }

          listener.handleEvent(message);
        }
      },
      onerror: null,
    };

    instances.push(instance);
    return instance;
  }

  return {
    instances,
    install() {
      instances.length = 0;
      vi.stubGlobal(
        "EventSource",
        MockEventSource as unknown as typeof EventSource
      );
    },
  };
}

export function registerEventSourceMockLifecycle(
  eventSource: ReturnType<typeof createEventSourceMock>,
  options: { fakeTimers?: boolean } = {}
) {
  beforeEach(() => {
    if (options.fakeTimers) {
      vi.useFakeTimers();
    }

    eventSource.install();
  });

  afterEach(() => {
    if (options.fakeTimers) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export function makeCellFixture(
  id: string,
  workspaceId: string,
  overrides: Partial<Cell> = {}
): Cell {
  return {
    id,
    name: `Cell ${id}`,
    description: null,
    templateId: "template",
    workspacePath: `/tmp/${id}`,
    workspaceId,
    workspaceRootPath: "/tmp/workspace",
    opencodeSessionId: null,
    opencodeCommand: null,
    createdAt: new Date().toISOString(),
    status: "ready",
    lastSetupError: undefined,
    branchName: undefined,
    baseCommit: undefined,
    ...overrides,
  };
}
