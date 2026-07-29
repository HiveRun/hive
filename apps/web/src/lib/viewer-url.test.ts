import { describe, expect, it } from "vitest";
import {
  resolveBrowserViewerAvailability,
  resolveBrowserViewerTargets,
  resolveLoopbackHttpViewerUrl,
  resolveNativeViewerAvailability,
} from "./viewer-url";

describe("resolveLoopbackHttpViewerUrl", () => {
  it.each([
    ["http://localhost:4173/emulator", "http://localhost:4173/emulator"],
    ["https://127.0.0.1:9443/", "https://127.0.0.1:9443/"],
    ["http://[::1]:8080/", "http://[::1]:8080/"],
  ])("accepts loopback HTTP viewers", (input, expected) => {
    expect(resolveLoopbackHttpViewerUrl(input)).toBe(expected);
  });

  it.each([
    "tcp://localhost:4173",
    "http://example.com:4173",
    "http://localhost.example.com:4173",
    "http://user:secret@localhost:4173",
    "not a url",
    "",
  ])("rejects non-viewer resource %s", (input) => {
    expect(resolveLoopbackHttpViewerUrl(input)).toBeNull();
  });
});

describe("resolveBrowserViewerAvailability", () => {
  const runningViewer = {
    hasService: true,
    serviceStatus: "running",
    viewerUrl: "http://localhost:4173",
  };

  it("distinguishes empty and unsupported service targets", () => {
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        hasService: false,
        reachability: null,
        viewerUrl: null,
      })
    ).toBe("empty");
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        reachability: true,
        viewerUrl: "tcp://localhost:4173",
      })
    ).toBe("unsupported");
  });

  it("only marks running, reachable viewers ready", () => {
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        reachability: null,
      })
    ).toBe("checking");
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        reachability: false,
      })
    ).toBe("unreachable");
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        reachability: true,
      })
    ).toBe("ready");
    expect(
      resolveBrowserViewerAvailability({
        ...runningViewer,
        reachability: true,
        serviceStatus: "stopped",
      })
    ).toBe("not-running");
  });
});

describe("resolveBrowserViewerTargets", () => {
  it("includes secondary HTTP ports when the primary port is TCP", () => {
    expect(
      resolveBrowserViewerTargets([
        {
          id: "service-api",
          name: "api",
          port: 43_101,
          ports: [
            {
              name: "rpc",
              port: 43_101,
              portReachable: true,
              primary: true,
              protocol: "tcp",
            },
            {
              name: "admin",
              port: 43_102,
              portReachable: true,
              primary: false,
              protocol: "http",
              url: "http://localhost:43102/",
            },
          ],
          status: "running",
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: "service-api:admin",
        portName: "admin",
        protocol: "http",
        testId: "api-admin",
        url: "http://localhost:43102/",
      }),
    ]);
  });

  it("creates a stable target for every named HTTP or HTTPS port", () => {
    expect(
      resolveBrowserViewerTargets([
        {
          id: "service-web",
          name: "web",
          port: 3000,
          ports: [
            {
              name: "http",
              port: 3000,
              portReachable: true,
              primary: true,
              protocol: "http",
              url: "http://localhost:3000/",
            },
            {
              name: "secure",
              port: 3443,
              portReachable: false,
              primary: false,
              protocol: "https",
              url: "https://localhost:3443/",
            },
          ],
          status: "running",
          url: "http://localhost:3000/",
        },
      ]).map(({ id, protocol, testId }) => ({ id, protocol, testId }))
    ).toEqual([
      { id: "service-web", protocol: "http", testId: "web-http" },
      {
        id: "service-web:secure",
        protocol: "https",
        testId: "web-secure",
      },
    ]);
  });

  it("retains legacy scalar targets and derives HTTPS", () => {
    expect(
      resolveBrowserViewerTargets([
        {
          id: "legacy-web",
          name: "legacy",
          port: 9443,
          portReachable: true,
          status: "running",
          url: "https://localhost:9443/",
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: "legacy-web",
        portName: "default",
        protocol: "https",
        testId: "legacy",
      }),
    ]);
  });
});

describe("resolveNativeViewerAvailability", () => {
  const readyTarget = {
    id: "service-web",
    label: "web",
    port: 3000,
    portName: "http",
    portReachable: true,
    primary: true,
    protocol: "http" as const,
    serviceId: "service-web",
    serviceName: "web",
    status: "running",
    testId: "web",
    url: "http://localhost:3000/",
  };

  it("requires a running, reachable loopback HTTP target", () => {
    expect(resolveNativeViewerAvailability(readyTarget)).toBe("ready");
    expect(
      resolveNativeViewerAvailability({
        ...readyTarget,
        portReachable: false,
      })
    ).toBe("unreachable");
    expect(
      resolveNativeViewerAvailability({ ...readyTarget, status: "stopped" })
    ).toBe("not-running");
    expect(
      resolveNativeViewerAvailability({
        ...readyTarget,
        url: "http://example.com:3000/",
      })
    ).toBe("unsupported");
  });

  it("returns empty without an active target", () => {
    expect(resolveNativeViewerAvailability(undefined)).toBe("empty");
  });
});
