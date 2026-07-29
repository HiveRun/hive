import { readFile as readArtifactFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRunningServicesCell,
  fileExists,
  requireApiUrl,
  waitForCondition,
} from "../src/test-helpers";

const DELETE_PROPAGATION_TIMEOUT_MS = 30_000;
const NOT_FOUND_STATUS = 404;
const EXPECTED_UNIQUE_TEARDOWN_PORT_COUNT = 4;

type TeardownRecord = {
  cellId: string;
  runtimeDir: string;
  artifactsDir: string;
  hiveHome: string;
  reason: string;
  ports: Record<string, string>;
};

test.describe("cell deletion cleanup", () => {
  test("deletes cell and reaps service processes", async ({ page }) => {
    const apiUrl = requireApiUrl();
    const { cellId, services: runningServices } =
      await createRunningServicesCell(page, apiUrl, {
        name: `E2E Cleanup ${Date.now()}`,
        timeoutMs: 120_000,
        errorMessage: "Services did not become running before delete",
        predicate: (services) =>
          services.length > 0 &&
          services.some(
            (service) => service.status.toLowerCase() === "running"
          ),
      });

    const runningPids = runningServices
      .map((service) => service.pid)
      .filter((pid): pid is number => typeof pid === "number");

    expect(runningPids.length).toBeGreaterThan(0);

    const deleteResponse = await fetch(`${apiUrl}/api/cells/${cellId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.ok).toBe(true);

    await waitForCondition({
      timeoutMs: DELETE_PROPAGATION_TIMEOUT_MS,
      errorMessage: "Cell record still exists after deletion",
      check: async () => {
        const response = await fetch(`${apiUrl}/api/cells/${cellId}`);
        return response.status === NOT_FOUND_STATUS;
      },
    });

    await waitForCondition({
      timeoutMs: DELETE_PROPAGATION_TIMEOUT_MS,
      errorMessage: "Service endpoint still returns data after cell deletion",
      check: async () => {
        const response = await fetch(`${apiUrl}/api/cells/${cellId}/services`);
        return response.status === NOT_FOUND_STATUS;
      },
    });

    await waitForCondition({
      timeoutMs: DELETE_PROPAGATION_TIMEOUT_MS,
      errorMessage: "Service process still alive after cell deletion",
      check: () =>
        Promise.resolve(runningPids.every((pid) => !isPidAlive(pid))),
    });

    const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
    if (!hiveHome) {
      throw new Error("HIVE_E2E_HIVE_HOME is required for deletion E2E tests");
    }
    const runtimeDir = joinPath(hiveHome, "runtime", "cells", cellId);
    const artifactsDir = joinPath(hiveHome, "artifacts", "cells", cellId);
    expect(await fileExists(runtimeDir)).toBe(false);
    expect(await fileExists(artifactsDir)).toBe(true);

    const teardownLines = (
      await readArtifactFile(joinPath(artifactsDir, "teardown.json"), "utf8")
    ).split("\n");
    expect(teardownLines[1]).toBe("complete");
    const teardown = JSON.parse(teardownLines[0] ?? "") as TeardownRecord;
    expect(teardown).toMatchObject({
      cellId,
      runtimeDir,
      artifactsDir,
      reason: "delete",
    });
    expect(teardown.hiveHome).toContain(cellId);
    expect(teardown.ports.database).toBe(teardown.ports.databasePrimary);
    expect(teardown.ports.apiHttp).toBe(teardown.ports.apiPrimary);
    expect(teardown.ports.worker).toBe(teardown.ports.workerPrimary);
    expect(new Set(Object.values(teardown.ports)).size).toBe(
      EXPECTED_UNIQUE_TEARDOWN_PORT_COUNT
    );
  });
});

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}
