import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIVE_MICROPHONE_STATUS_MESSAGE } from "@/lib/audio-input";

vi.mock("@tanstack/react-router", () => {
  const useRouteConfig = (config: Record<string, unknown>) => config;
  return { createFileRoute: () => useRouteConfig };
});

import {
  resolvePreferredViewerUrl,
  useBrowserReachability,
  useViewerMicrophoneError,
} from "./viewer";

const VIEWER_URL = "http://localhost:4173/";
const VIEWER_TARGET = {
  audioInput: false,
  id: "viewer",
  label: "viewer",
  port: 4173,
  portName: "web",
  portReachable: true,
  protocol: "http" as const,
  status: "running",
  testId: "viewer",
  url: VIEWER_URL,
};

const dispatchMicrophoneStatus = (
  status: "error" | "ready",
  origin: string,
  source?: MessageEventSource | null
) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: HIVE_MICROPHONE_STATUS_MESSAGE,
          status,
          ...(status === "error"
            ? { message: "Configured microphone is unavailable" }
            : {}),
        },
        origin,
        source,
      })
    );
  });
};

describe("resolvePreferredViewerUrl", () => {
  it("adds preferences only to audio-input-enabled services", () => {
    expect(resolvePreferredViewerUrl(VIEWER_TARGET, "USB Audio")).toBe(
      VIEWER_URL
    );
    expect(
      resolvePreferredViewerUrl(
        { ...VIEWER_TARGET, audioInput: true },
        "USB Audio"
      )
    ).toBe("http://localhost:4173/?hiveMicrophone=USB+Audio");
  });
});

describe("useBrowserReachability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not reuse reachability after a service restart", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ status }) =>
        useBrowserReachability({
          serviceStatus: status,
          viewerUrl: VIEWER_URL,
        }),
      { initialProps: { status: "running" } }
    );

    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchMock).toHaveBeenLastCalledWith(VIEWER_URL, {
      method: "GET",
      mode: "no-cors",
      signal: expect.any(AbortSignal),
    });
    rerender({ status: "stopped" });
    await waitFor(() => expect(result.current).toBeNull());

    rerender({ status: "running" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useViewerMicrophoneError", () => {
  it("accepts status only from the active viewer origin and clears on ready", () => {
    const iframe = document.createElement("iframe");
    iframe.dataset.testid = "web-iframe-preview";
    document.body.append(iframe);
    const { result } = renderHook(() =>
      useViewerMicrophoneError(VIEWER_URL, true)
    );

    dispatchMicrophoneStatus("error", "http://malicious.example");
    expect(result.current).toBeNull();

    dispatchMicrophoneStatus(
      "error",
      "http://localhost:4173",
      iframe.contentWindow
    );
    expect(result.current).toBe("Configured microphone is unavailable");

    dispatchMicrophoneStatus(
      "ready",
      "http://localhost:4173",
      iframe.contentWindow
    );
    expect(result.current).toBeNull();
    iframe.remove();
  });
});
