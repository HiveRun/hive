import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDb } from "../__tests__/test-db";
import { cells } from "../schema/cells";
import { cellServicePorts, cellServices } from "../schema/services";
import { createPortManager } from "./port-manager";

const NAMED_HTTP_PORTS = [
  {
    name: "http",
    primary: true,
    protocol: "http" as const,
    viewer: true,
  },
  {
    name: "metrics",
    primary: false,
    protocol: "http" as const,
    viewer: true,
  },
];

describe("port manager", () => {
  beforeAll(setupTestDb);

  beforeEach(async () => {
    await testDb.delete(cellServicePorts);
    await testDb.delete(cellServices);
    await testDb.delete(cells);
  });

  it("persists, reuses, and releases every named claim", async () => {
    const service = await insertService();
    const firstManager = createPortManager({
      db: testDb,
      now: () => new Date(),
    });
    const first = await firstManager.ensureServicePorts(
      service,
      NAMED_HTTP_PORTS
    );

    expect(first.ports.size).toBe(2);
    expect(first.ports.get("http")).not.toBe(first.ports.get("metrics"));
    expect(await firstManager.ensureServicePort(service)).toBe(
      first.ports.get("http")
    );
    const claims = await testDb
      .select()
      .from(cellServicePorts)
      .where(eq(cellServicePorts.serviceId, service.id));
    expect(claims).toHaveLength(2);
    expect(claims.find((claim) => claim.primary)?.name).toBe("http");

    const [persistedService] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));
    expect(persistedService?.port).toBe(first.ports.get("http"));

    firstManager.releasePortFor(service.id);
    expect(firstManager.getServicePorts(service.id)).toBeUndefined();

    const restartManager = createPortManager({
      db: testDb,
      now: () => new Date(),
    });
    const restarted = await restartManager.ensureServicePorts(
      persistedService ?? service,
      NAMED_HTTP_PORTS
    );
    expect(Object.fromEntries(restarted.ports)).toEqual(
      Object.fromEntries(first.ports)
    );

    restartManager.releasePortFor(service.id);
    expect(restartManager.getServicePorts(service.id)).toBeUndefined();
  });

  it("serializes concurrent multi-service allocations", async () => {
    const firstService = await insertService("first");
    const secondService = await insertService("second");
    const manager = createPortManager({
      db: testDb,
      now: () => new Date(),
    });
    const allocations = await Promise.all([
      manager.ensureServicePorts(firstService, NAMED_HTTP_PORTS),
      manager.ensureServicePorts(secondService, NAMED_HTTP_PORTS),
    ]);
    const allocatedPorts = allocations.flatMap((allocation) => [
      ...allocation.ports.values(),
    ]);

    expect(new Set(allocatedPorts).size).toBe(allocatedPorts.length);
  });
});

async function insertService(name = "web") {
  const cellId = randomUUID();
  await testDb.insert(cells).values({
    id: cellId,
    name: "Port manager cell",
    description: null,
    templateId: "ports",
    workspacePath: "/tmp",
    workspaceId: randomUUID(),
    workspaceRootPath: "/tmp",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "ready",
  });
  const [service] = await testDb
    .insert(cellServices)
    .values({
      id: randomUUID(),
      cellId,
      name,
      type: "process",
      command: "bun run dev",
      cwd: "/tmp",
      env: {},
      status: "pending",
      port: null,
      pid: null,
      readyTimeoutMs: null,
      definition: {
        type: "process",
        run: "bun run dev",
        ports: { http: { primary: true }, metrics: {} },
      },
      lastKnownError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!service) {
    throw new Error("Failed to insert service");
  }
  return service;
}
