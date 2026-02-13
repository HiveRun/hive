import { expect, test } from "@playwright/test";
import {
  createCell,
  waitForCondition,
  waitForServiceStatuses,
} from "../src/test-helpers";

const SERVICES_TEMPLATE_LABEL = "E2E Services Template";
const DELETE_PROPAGATION_TIMEOUT_MS = 30_000;
const NOT_FOUND_STATUS = 404;

test.describe("cell deletion cleanup", () => {
  test("deletes cell and reaps service processes", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Cleanup ${Date.now()}`,
      templateLabel: SERVICES_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/services`);

    const runningServices = await waitForServiceStatuses({
      apiUrl,
      cellId,
      timeoutMs: 120_000,
      errorMessage: "Services did not become running before delete",
      predicate: (services) =>
        services.length > 0 &&
        services.some((service) => service.status.toLowerCase() === "running"),
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
