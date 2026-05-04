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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("service events", () => {
  test("subscriber receives emitted events for matching cell", () => {
    const event: ServiceUpdateEvent = {
      cellId: "cell-1",
      serviceId: "service-123",
    };
    expectSubscriberReceives(
      subscribeToServiceEvents,
      emitServiceUpdate,
      event
    );
  });

  test("subscriber does not receive events for other cells", () => {
    expectSubscriberIgnoresOtherScope(
      subscribeToServiceEvents,
      emitServiceUpdate,
      {
        subscribeId: "cell-1",
        event: { cellId: "cell-2", serviceId: "service-456" },
      }
    );
  });

  test("unsubscribe stops receiving events", () => {
    expectUnsubscribeStops({
      subscribe: subscribeToServiceEvents,
      emit: emitServiceUpdate,
      event: { cellId: "cell-1", serviceId: "service-123" },
    });
  });
});

describe("cell status events", () => {
  test("subscriber receives emitted events for matching workspace", () => {
    const event: CellStatusEvent = {
      workspaceId: "workspace-1",
      cellId: "cell-123",
      status: "ready",
    };
    expectSubscriberReceives(
      subscribeToCellStatusEvents,
      emitCellStatusUpdate,
      event
    );
  });

  test("subscriber does not receive events for other workspaces", () => {
    expectSubscriberIgnoresOtherScope(
      subscribeToCellStatusEvents,
      emitCellStatusUpdate,
      {
        subscribeId: "workspace-1",
        event: {
          workspaceId: "workspace-2",
          cellId: "cell-456",
          status: "ready",
        },
      }
    );
  });

  test("unsubscribe stops receiving events", () => {
    expectUnsubscribeStops({
      subscribe: subscribeToCellStatusEvents,
      emit: emitCellStatusUpdate,
      event: {
        workspaceId: "workspace-1",
        cellId: "cell-123",
        status: "ready",
      },
    });
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
  test("subscriber receives emitted events for matching cell", () => {
    const event: CellTimingEvent = {
      cellId: "cell-1",
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    };
    expectSubscriberReceives(
      subscribeToCellTimingEvents,
      emitCellTimingUpdate,
      event
    );
  });

  test("subscriber does not receive events for other cells", () => {
    expectSubscriberIgnoresOtherScope(
      subscribeToCellTimingEvents,
      emitCellTimingUpdate,
      {
        subscribeId: "cell-1",
        event: makeTimingEvent({ cellId: "cell-2" }),
      }
    );
  });

  test("unsubscribe stops receiving events", () => {
    expectUnsubscribeStops({
      subscribe: subscribeToCellTimingEvents,
      emit: emitCellTimingUpdate,
      event: makeTimingEvent({ step: "mark_ready" }),
    });
  });
});

type Subscriber<T> = (
  scopeId: string,
  handler: (event: T) => void
) => () => void;
type Emitter<T> = (event: T) => void;

function expectSubscriberReceives<
  T extends { cellId?: string; workspaceId?: string },
>(subscribe: Subscriber<T>, emit: Emitter<T>, event: T) {
  const { handler, unsubscribe } = subscribeForEvent(subscribe, event);

  emitAndAssert(emit, event, () => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: callback is executed inside the test helper.
    expect(handler).toHaveBeenCalledWith(event);
  });
  unsubscribe();
}

function emitAndAssert<T>(emit: Emitter<T>, event: T, assert: () => void) {
  emit(event);
  assert();
}

function expectSubscriberIgnoresOtherScope<T>(
  subscribe: Subscriber<T>,
  emit: Emitter<T>,
  args: { subscribeId: string; event: T }
) {
  const handler = vi.fn();
  const unsubscribe = subscribe(args.subscribeId, handler);

  emitAndAssert(emit, args.event, () => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: callback is executed inside the test helper.
    expect(handler).not.toHaveBeenCalled();
  });
  unsubscribe();
}

function expectUnsubscribeStops<
  T extends { cellId?: string; workspaceId?: string },
>(args: { subscribe: Subscriber<T>; emit: Emitter<T>; event: T }) {
  const { subscribe, emit, event } = args;
  const scopeId = event.workspaceId ?? event.cellId ?? "";
  const handler = vi.fn();
  const unsubscribe = subscribe(scopeId, handler);
  unsubscribe();
  emitAndAssert(emit, event, () => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: callback is executed inside the test helper.
    expect(handler).not.toHaveBeenCalled();
  });
}

function subscribeForEvent<T extends { cellId?: string; workspaceId?: string }>(
  subscribe: Subscriber<T>,
  event: T
) {
  const handler = vi.fn();
  const unsubscribe = subscribe(
    event.workspaceId ?? event.cellId ?? "",
    handler
  );
  return { handler, unsubscribe };
}

function makeTimingEvent(
  overrides: Partial<CellTimingEvent> = {}
): CellTimingEvent {
  return {
    cellId: "cell-1",
    workflow: "create",
    runId: "run-1",
    step: "create_worktree",
    status: "ok",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
