import { vi } from "vitest";

const noop = () => null;

export function installResizeObserverMock() {
  globalThis.ResizeObserver = class ResizeObserver {
    disconnect = noop;
    observe = noop;
    unobserve = noop;
  } as typeof ResizeObserver;
}

export function installPointerCaptureMocks() {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= noop;
  Element.prototype.setPointerCapture ??= noop;
}

export function installImmediateAnimationFrameMock() {
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    writable: true,
  });

  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
}

export function workspaceListQueryResult() {
  return {
    data: {
      workspaces: [
        {
          id: "workspace-1",
          label: "Workspace One",
          path: "/tmp/workspace-one",
        },
      ],
    },
    error: null,
    isPending: false,
  };
}
