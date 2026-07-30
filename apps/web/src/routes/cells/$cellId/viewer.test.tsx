import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => {
  const useRouteConfig = (config: Record<string, unknown>) => config;
  return { createFileRoute: () => useRouteConfig };
});

import { useBrowserReachability } from "./viewer";

const VIEWER_URL = "http://localhost:4173/";

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
    rerender({ status: "stopped" });
    await waitFor(() => expect(result.current).toBeNull());

    rerender({ status: "running" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
