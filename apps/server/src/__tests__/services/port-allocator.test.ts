import type { PortRequest } from "@synthetic/config";
import { describe, expect, it } from "vitest";
import { allocatePorts, createPortEnv } from "../../services/port-allocator";

describe("allocatePorts", () => {
  it("allocates requested ports", async () => {
    const requests: PortRequest[] = [
      { name: "api", preferred: 50_000 },
      { name: "web", preferred: 50_001 },
    ];

    const allocated = await allocatePorts(requests);

    expect(allocated).toHaveLength(2);
    expect(allocated[0]?.name).toBe("api");
    expect(allocated[0]?.port).toBeDefined();
    expect(allocated[1]?.name).toBe("web");
    expect(allocated[1]?.port).toBeDefined();
  });

  it("allocates unique ports", async () => {
    const requests: PortRequest[] = [
      { name: "api" },
      { name: "web" },
      { name: "db" },
    ];

    const allocated = await allocatePorts(requests);
    expect(allocated).toHaveLength(3);

    const ports = allocated.map((a) => a.port);

    for (const port of ports) {
      expect(port).toBeGreaterThan(1023);
      expect(port).toBeLessThan(65_536);
    }

    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(3);

    expect(allocated[0]?.port).toBeDefined();
    expect(allocated[1]?.port).toBeDefined();
    expect(allocated[2]?.port).toBeDefined();
  });

  it("uses preferred ports when available", async () => {
    const requests: PortRequest[] = [{ name: "api", preferred: 50_000 }];

    const allocated = await allocatePorts(requests);

    expect(allocated[0]?.port).toBe(50_000);
    expect(allocated[0]?.preferred).toBe(true);
  });
});

describe("createPortEnv", () => {
  it("creates env vars from allocations", () => {
    const requests: PortRequest[] = [
      { name: "api", preferred: 3000, env: "API_PORT" },
      { name: "web", preferred: 3001, env: "WEB_PORT" },
    ];

    const allocations = [
      { name: "api", port: 3000, preferred: true },
      { name: "web", port: 3001, preferred: true },
    ];

    const env = createPortEnv(allocations, requests);

    expect(env).toEqual({
      API_PORT: "3000",
      WEB_PORT: "3001",
    });
  });

  it("skips ports without env vars", () => {
    const requests: PortRequest[] = [
      { name: "api", preferred: 3000, env: "API_PORT" },
      { name: "web", preferred: 3001 },
    ];

    const allocations = [
      { name: "api", port: 3000, preferred: true },
      { name: "web", port: 3001, preferred: true },
    ];

    const env = createPortEnv(allocations, requests);

    expect(env).toEqual({
      API_PORT: "3000",
    });
  });
});
