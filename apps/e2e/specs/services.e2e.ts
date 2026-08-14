import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRunningServicesCell,
  requireApiUrl,
  requireCellPaths,
  waitForActivityTypes,
  waitForServiceStatuses as waitForStatuses,
} from "../src/test-helpers";

const API_OPTION_PATTERN = /api/i;
const EXPECTED_SERVICE_PORTS = {
  database: [{ name: "postgres", primary: true, protocol: "tcp" }],
  api: [
    { name: "http", primary: true, protocol: "http" },
    { name: "metrics", primary: false, protocol: "tcp" },
  ],
  worker: [{ name: "control", primary: true, protocol: "tcp" }],
} as const;
const EXPECTED_SERVICE_COUNT = Object.keys(EXPECTED_SERVICE_PORTS).length;

test.describe("service controls", () => {
  test("starts and stops services from the services panel", async ({
    page,
  }) => {
    const apiUrl = requireApiUrl();
    const { cellId, services: runningServices } =
      await createRunningServicesCell(page, apiUrl);

    const servicesByName = new Map(
      runningServices.map((service) => [service.name, service])
    );
    const database = servicesByName.get("database");
    const api = servicesByName.get("api");
    const worker = servicesByName.get("worker");
    for (const [serviceName, expectedPorts] of Object.entries(
      EXPECTED_SERVICE_PORTS
    )) {
      expect(servicesByName.get(serviceName)?.ports, serviceName).toEqual(
        expectedPorts.map((port) =>
          expect.objectContaining({ ...port, portReachable: true })
        )
      );
    }

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

    const { artifactsDir, runtimeDir } = requireCellPaths(cellId);
    const expectedMarkers = {
      "database-ready.json": {
        namedPort: database?.env.DATABASE_POSTGRES_PORT,
        port: database?.env.DATABASE_PORT,
        runtimeDir,
      },
      "api-ready.json": {
        artifactsDir,
        databasePort: database?.env.DATABASE_POSTGRES_PORT,
        httpPort: api?.env.API_HTTP_PORT,
        metricsPort: api?.env.API_METRICS_PORT,
        primaryPort: api?.env.API_PORT,
        runtimeDir,
      },
      "worker-ready.json": {
        apiPort: api?.env.API_HTTP_PORT,
        controlPort: worker?.env.WORKER_CONTROL_PORT,
      },
    };
    for (const [fileName, expectedMarker] of Object.entries(expectedMarkers)) {
      expect(
        await readJson(join(runtimeDir, fileName)),
        fileName
      ).toMatchObject(expectedMarker);
    }

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

    const expectedActivityTypes = ["services.stop", "services.start"];
    const events = await waitForActivityTypes({
      apiUrl,
      cellId,
      types: expectedActivityTypes,
      timeoutMs: 30_000,
      errorMessage: "Expected service activity events were not recorded",
    });
    const eventTypes = new Set(events.map((event) => event.type));
    for (const type of expectedActivityTypes) {
      expect(eventTypes.has(type), type).toBe(true);
    }
  });
});

async function readJson(path: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
}
