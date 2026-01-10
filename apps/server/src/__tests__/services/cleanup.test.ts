import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServiceStatus } from "../../schema/services";

const execMock = vi.fn();

vi.mock("node:child_process", () => ({
  exec: execMock,
}));

const { cleanupOrphanedServiceProcesses } = await import(
  "../../services/cleanup"
);

type ServiceRecord = {
  id: string;
  pid: number | null;
  port: number | null;
  status: ServiceStatus;
};

describe("cleanupOrphanedServiceProcesses", () => {
  const originalKill = process.kill;

  beforeEach(() => {
    execMock.mockReset();
  });

  afterEach(() => {
    process.kill = originalKill;
  });

  const alivePid = 123;
  const alivePort = 4444;

  it("skips cleanup when pid is alive", async () => {
    process.kill = vi.fn((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && pid === alivePid) {
        return true as never;
      }
      throw new Error("unexpected kill");
    }) as unknown as typeof process.kill;

    const services: ServiceRecord[] = [
      { id: "svc-1", pid: alivePid, port: alivePort, status: "running" },
    ];

    const result = await cleanupOrphanedServiceProcesses(services);

    expect(result.updatedServiceIds).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });

  const deadPid = 456;
  const deadPort = 5555;
  const reclaimedPid = 999;

  it("kills process on port when pid is dead", async () => {
    process.kill = vi.fn(() => {
      throw new Error("dead pid");
    }) as unknown as typeof process.kill;

    execMock.mockImplementation(
      (command: string, options: unknown, cb?: unknown) => {
        const callback = typeof options === "function" ? options : cb;
        const stdout = command.includes(`lsof -ti:${deadPort}`)
          ? `${reclaimedPid}\n`
          : "";
        if (typeof callback === "function") {
          callback(null, { stdout, stderr: "" });
        }
        return {};
      }
    );

    const services: ServiceRecord[] = [
      { id: "svc-2", pid: deadPid, port: deadPort, status: "running" },
    ];

    const result = await cleanupOrphanedServiceProcesses(services);

    expect(result.cleanedPids).toEqual([reclaimedPid]);
    expect(result.updatedServiceIds).toEqual(["svc-2"]);
  });

  const stoppedPort = 6666;
  const stoppedPid = 777;

  it("does not mark stopped services for restart", async () => {
    process.kill = vi.fn(() => {
      throw new Error("dead pid");
    }) as unknown as typeof process.kill;

    execMock.mockImplementation(
      (command: string, options: unknown, cb?: unknown) => {
        const callback = typeof options === "function" ? options : cb;
        const stdout = command.includes(`lsof -ti:${stoppedPort}`)
          ? `${stoppedPid}\n`
          : "";
        if (typeof callback === "function") {
          callback(null, { stdout, stderr: "" });
        }
        return {};
      }
    );

    const services: ServiceRecord[] = [
      { id: "svc-3", pid: null, port: stoppedPort, status: "stopped" },
    ];

    const result = await cleanupOrphanedServiceProcesses(services);

    expect(result.cleanedPids).toEqual([stoppedPid]);
    expect(result.updatedServiceIds).toEqual([]);
  });
});
