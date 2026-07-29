import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRunningServicesCell,
  fetchActivity,
  requireApiUrl,
  waitForCondition,
  waitForServiceStatuses as waitForStatuses,
} from "../src/test-helpers";

const EXPECTED_SERVICE_COUNT = 3;
const API_OPTION_PATTERN = /api/i;

function requireHiveHome(): string {
  const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
  if (!hiveHome) {
    throw new Error("HIVE_E2E_HIVE_HOME is required for service E2E tests");
  }
  return hiveHome;
}

test.describe("service controls", () => {
  test("starts and stops services from the services panel", async ({
    page,
  }) => {
    const apiUrl = requireApiUrl();
    const { cellId, services: runningServices } =
      await createRunningServicesCell(page, apiUrl, {
        name: `E2E Services ${Date.now()}`,
        errorMessage: "Services did not become running after creation",
        predicate: (services) =>
          services.length === EXPECTED_SERVICE_COUNT &&
          services.every(
            (service) => service.status.toLowerCase() === "running"
          ),
      });

    const servicesByName = new Map(
      runningServices.map((service) => [service.name, service])
    );
    const database = servicesByName.get("database");
    const api = servicesByName.get("api");
    const worker = servicesByName.get("worker");
    expect(database?.ports).toEqual([
      expect.objectContaining({
        name: "postgres",
        primary: true,
        protocol: "tcp",
        portReachable: true,
      }),
    ]);
    expect(api?.ports).toEqual([
      expect.objectContaining({
        name: "http",
        primary: true,
        protocol: "http",
        portReachable: true,
      }),
      expect.objectContaining({
        name: "metrics",
        primary: false,
        protocol: "tcp",
        portReachable: true,
      }),
    ]);
    expect(worker?.ports).toEqual([
      expect.objectContaining({
        name: "control",
        primary: true,
        protocol: "tcp",
        portReachable: true,
      }),
    ]);

    const allocatedPorts = runningServices.flatMap((service) =>
      service.ports.map((port) => port.port)
    );
    expect(new Set(allocatedPorts).size).toBe(allocatedPorts.length);
    expect(api?.port).toBe(api?.ports[0]?.port);
    expect(api?.url).toBe(`http://localhost:${api?.port}`);
    expect(api?.env.DB_PORT).toBe(database?.env.DATABASE_POSTGRES_PORT);
    expect(api?.env.METRICS_PORT).toBe(api?.env.API_METRICS_PORT);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: API_OPTION_PATTERN }).click();
    await expect(page.getByLabel("http URL")).toBeVisible();
    await expect(page.getByLabel("metrics port")).toBeVisible();

    const runtimeDir = join(requireHiveHome(), "runtime", "cells", cellId);
    const [databaseMarker, apiMarker, workerMarker] = await Promise.all([
      readJson(join(runtimeDir, "database-ready.json")),
      readJson(join(runtimeDir, "api-ready.json")),
      readJson(join(runtimeDir, "worker-ready.json")),
    ]);
    expect(databaseMarker).toMatchObject({
      port: database?.env.DATABASE_PORT,
      namedPort: database?.env.DATABASE_POSTGRES_PORT,
      runtimeDir,
    });
    expect(apiMarker).toMatchObject({
      databasePort: database?.env.DATABASE_POSTGRES_PORT,
      httpPort: api?.env.API_HTTP_PORT,
      primaryPort: api?.env.API_PORT,
      metricsPort: api?.env.API_METRICS_PORT,
      runtimeDir,
      artifactsDir: join(requireHiveHome(), "artifacts", "cells", cellId),
    });
    expect(workerMarker).toMatchObject({
      apiPort: api?.env.API_HTTP_PORT,
      controlPort: worker?.env.WORKER_CONTROL_PORT,
    });

    await waitForStatuses({
      apiUrl,
      cellId,
      includeResources: true,
      errorMessage: "Resource snapshots did not appear for running services",
      predicate: (services) =>
        services.some(
          (service) =>
            typeof service.cpuPercent === "number" ||
            typeof service.rssBytes === "number"
        ),
    });

    await page.getByRole("button", { name: "Stop all" }).click();
    await waitForStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not stop after stop-all",
      predicate: (services) =>
        services.length === EXPECTED_SERVICE_COUNT &&
        services.every((service) => service.status.toLowerCase() === "stopped"),
    });

    await page.getByRole("button", { name: "Start all" }).click();
    await waitForStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not restart after start-all",
      predicate: (services) =>
        services.length === EXPECTED_SERVICE_COUNT &&
        services.every(
          (service) =>
            service.status.toLowerCase() === "running" &&
            service.ports.every((port) => port.portReachable)
        ),
    });

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Expected service activity events were not recorded",
      check: async () => {
        const events = await fetchActivity(apiUrl, cellId);
        const eventTypes = new Set(events.map((event) => event.type));
        return (
          eventTypes.has("services.stop") && eventTypes.has("services.start")
        );
      },
    });

    const events = await fetchActivity(apiUrl, cellId);
    const eventTypes = new Set(events.map((event) => event.type));
    expect(eventTypes.has("services.stop")).toBe(true);
    expect(eventTypes.has("services.start")).toBe(true);
  });
});

async function readJson(path: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
}
