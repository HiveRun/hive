import { describe, expect, it } from "vitest";
import {
  createServiceTerminalRuntime,
  type ServiceTerminalEvent,
} from "./service-terminal";

describe("service terminal runtime", () => {
  it("notifies subscribers when a service session is replaced", () => {
    const runtime = createServiceTerminalRuntime();
    runtime.startServiceSession({
      serviceId: "web",
      cwd: "/workspace",
      process: { pid: 101 },
    });
    const events: ServiceTerminalEvent[] = [];
    const unsubscribe = runtime.subscribeToService("web", (event) => {
      events.push(event);
    });

    runtime.startServiceSession({
      serviceId: "web",
      cwd: "/workspace",
      process: { pid: 202 },
    });
    unsubscribe();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "session",
      session: expect.objectContaining({
        pid: 202,
        status: "running",
      }),
    });
  });
});
