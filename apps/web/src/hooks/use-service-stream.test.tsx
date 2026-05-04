import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createEventSourceMock,
  registerEventSourceMockLifecycle,
} from "./event-source-test-utils";
import { useServiceStream } from "./use-service-stream";

const eventSource = createEventSourceMock();

describe("useServiceStream", () => {
  registerEventSourceMockLifecycle(eventSource);

  it("does not include includeResources query by default", () => {
    renderHook(() => useServiceStream("cell-1", { enabled: true }));

    expect(eventSource.instances).toHaveLength(1);
    expect(eventSource.instances[0]?.url).toContain(
      "/api/cells/cell-1/services/stream"
    );
    expect(eventSource.instances[0]?.url).not.toContain("includeResources");
  });

  it("includes includeResources query when enabled", () => {
    renderHook(() =>
      useServiceStream("cell-1", { enabled: true, includeResources: true })
    );

    expect(eventSource.instances).toHaveLength(1);
    expect(eventSource.instances[0]?.url).toContain(
      "/api/cells/cell-1/services/stream?includeResources=true"
    );
  });
});
