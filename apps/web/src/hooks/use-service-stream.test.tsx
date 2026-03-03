import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServiceStream } from "./use-service-stream";

type MockEventSourceInstance = {
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
};

const mockEventSourceInstances: MockEventSourceInstance[] = [];

function MockEventSource(url: string): MockEventSourceInstance {
  const instance: MockEventSourceInstance = {
    url,
    closed: false,
    addEventListener() {
      return;
    },
    removeEventListener() {
      return;
    },
    close() {
      instance.closed = true;
    },
  };

  mockEventSourceInstances.push(instance);
  return instance;
}

describe("useServiceStream", () => {
  beforeEach(() => {
    mockEventSourceInstances.length = 0;
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not include includeResources query by default", () => {
    renderHook(() => useServiceStream("cell-1", { enabled: true }));

    expect(mockEventSourceInstances).toHaveLength(1);
    expect(mockEventSourceInstances[0]?.url).toContain(
      "/api/cells/cell-1/services/stream"
    );
    expect(mockEventSourceInstances[0]?.url).not.toContain("includeResources");
  });

  it("includes includeResources query when enabled", () => {
    renderHook(() =>
      useServiceStream("cell-1", { enabled: true, includeResources: true })
    );

    expect(mockEventSourceInstances).toHaveLength(1);
    expect(mockEventSourceInstances[0]?.url).toContain(
      "/api/cells/cell-1/services/stream?includeResources=true"
    );
  });
});
