import { describe, expect, it } from "vitest";
import {
  type BrowserViewerAvailability,
  type BrowserViewerTarget,
  resolveBrowserViewerTargets,
  resolveLoopbackHttpViewerUrl,
  resolveViewerAvailability,
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
    null,
  ])("rejects non-viewer resource %s", (input) => {
    expect(resolveLoopbackHttpViewerUrl(input)).toBeNull();
  });
});

describe("resolveViewerAvailability", () => {
  const readyTarget: BrowserViewerTarget = {
    id: "service-web",
    label: "web",
    port: 3000,
    portName: "http",
    portReachable: true,
    protocol: "http",
    status: "running",
    testId: "web",
    url: "http://localhost:3000/",
  };
  const stoppedTarget = { ...readyTarget, status: "stopped" };
  const remoteTarget = {
    ...stoppedTarget,
    url: "http://example.com:3000/",
  };

  it.each<
    [
      string,
      BrowserViewerTarget | undefined,
      boolean | null | undefined,
      BrowserViewerAvailability,
    ]
  >([
    ["has no target", undefined, true, "empty"],
    [
      "rejects remote targets before status",
      remoteTarget,
      false,
      "unsupported",
    ],
    ["requires a running service", stoppedTarget, false, "not-running"],
    ["uses target reachability by default", readyTarget, undefined, "ready"],
    ["accepts a pending browser override", readyTarget, null, "checking"],
    ["accepts an unreachable override", readyTarget, false, "unreachable"],
    ["accepts a reachable browser override", readyTarget, true, "ready"],
  ])("%s", (_name, target, reachability, expected) => {
    expect(resolveViewerAvailability(target, reachability)).toBe(expected);
  });
});

describe("resolveBrowserViewerTargets", () => {
  it("creates stable targets for every named HTTP or HTTPS port", () => {
    const targets = resolveBrowserViewerTargets([
      {
        id: "service-api",
        name: "api",
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
      {
        id: "service-web",
        name: "web",
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
      {
        id: "service-docs",
        name: "docs",
        ports: [
          {
            name: "browser",
            port: 4173,
            portReachable: true,
            primary: true,
            protocol: "http",
          },
        ],
        status: "running",
        url: "http://localhost:4173/",
      },
    ]);

    expect(
      targets.map(({ id, portName, protocol, testId, url }) => ({
        id,
        portName,
        protocol,
        testId,
        url,
      }))
    ).toEqual([
      {
        id: "service-api:admin",
        portName: "admin",
        protocol: "http",
        testId: "api-admin",
        url: "http://localhost:43102/",
      },
      {
        id: "service-web",
        portName: "http",
        protocol: "http",
        testId: "web-http",
        url: "http://localhost:3000/",
      },
      {
        id: "service-web:secure",
        portName: "secure",
        protocol: "https",
        testId: "web-secure",
        url: "https://localhost:3443/",
      },
      {
        id: "service-docs",
        portName: "browser",
        protocol: "http",
        testId: "docs",
        url: "http://localhost:4173/",
      },
    ]);
  });
});
