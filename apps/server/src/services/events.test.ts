import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type CellStatusEvent,
  type CellTimingEvent,
  emitCellStatusUpdate,
  emitCellTimingUpdate,
  emitServiceUpdate,
  type ServiceUpdateEvent,
  subscribeToCellStatusEvents,
  subscribeToCellTimingEvents,
  subscribeToServiceEvents,
} from "./events";

describe("service events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("subscriber receives emitted events for matching cell", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToServiceEvents("cell-1", handler);

    const event: ServiceUpdateEvent = {
      cellId: "cell-1",
      serviceId: "service-123",
    };
    emitServiceUpdate(event);

    expect(handler).toHaveBeenCalledWith(event);
    unsubscribe();
  });

  test("subscriber does not receive events for other cells", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToServiceEvents("cell-1", handler);

    emitServiceUpdate({
      cellId: "cell-2",
      serviceId: "service-456",
    });

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("unsubscribe stops receiving events", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToServiceEvents("cell-1", handler);

    unsubscribe();

    emitServiceUpdate({
      cellId: "cell-1",
      serviceId: "service-123",
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("cell status events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("subscriber receives emitted events for matching workspace", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellStatusEvents("workspace-1", handler);

    const event: CellStatusEvent = {
      workspaceId: "workspace-1",
      cellId: "cell-123",
      status: "ready",
    };
    emitCellStatusUpdate(event);

    expect(handler).toHaveBeenCalledWith(event);
    unsubscribe();
  });

  test("subscriber does not receive events for other workspaces", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellStatusEvents("workspace-1", handler);

    emitCellStatusUpdate({
      workspaceId: "workspace-2",
      cellId: "cell-456",
      status: "ready",
    });

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("unsubscribe stops receiving events", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellStatusEvents("workspace-1", handler);

    unsubscribe();

    emitCellStatusUpdate({
      workspaceId: "workspace-1",
      cellId: "cell-123",
      status: "ready",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  test("receives events with error status and lastSetupError", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellStatusEvents("workspace-1", handler);

    const event: CellStatusEvent = {
      workspaceId: "workspace-1",
      cellId: "cell-123",
      status: "error",
      lastSetupError: "Setup command failed with exit code 1",
    };
    emitCellStatusUpdate(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect((handler.mock.calls[0] as [CellStatusEvent])[0].lastSetupError).toBe(
      "Setup command failed with exit code 1"
    );
    unsubscribe();
  });

  test("multiple subscribers receive the same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsubscribe1 = subscribeToCellStatusEvents("workspace-1", handler1);
    const unsubscribe2 = subscribeToCellStatusEvents("workspace-1", handler2);

    const event: CellStatusEvent = {
      workspaceId: "workspace-1",
      cellId: "cell-123",
      status: "spawning",
    };
    emitCellStatusUpdate(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);

    unsubscribe1();
    unsubscribe2();
  });
});

describe("cell timing events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("subscriber receives emitted events for matching cell", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellTimingEvents("cell-1", handler);

    const event: CellTimingEvent = {
      cellId: "cell-1",
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    };
    emitCellTimingUpdate(event);

    expect(handler).toHaveBeenCalledWith(event);
    unsubscribe();
  });

  test("subscriber does not receive events for other cells", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellTimingEvents("cell-1", handler);

    emitCellTimingUpdate({
      cellId: "cell-2",
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("unsubscribe stops receiving events", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToCellTimingEvents("cell-1", handler);

    unsubscribe();

    emitCellTimingUpdate({
      cellId: "cell-1",
      workflow: "create",
      runId: "run-1",
      step: "mark_ready",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
