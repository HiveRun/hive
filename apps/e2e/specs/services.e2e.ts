import { expect, test } from "@playwright/test";
import {
  createCell,
  fetchActivity,
  waitForCondition,
  waitForServiceStatuses,
} from "../src/test-helpers";

const SERVICES_TEMPLATE_LABEL = "E2E Services Template";
test.describe("service controls", () => {
  test("starts and stops services from the services panel", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Services ${Date.now()}`,
      templateLabel: SERVICES_TEMPLATE_LABEL,
    });

    await page.goto(`/cells/${cellId}/services`);

    await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not become running after creation",
      predicate: (services) =>
        services.length >= 1 &&
        services.some((service) => service.status.toLowerCase() === "running"),
    });

    await waitForServiceStatuses({
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
    await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not stop after stop-all",
      predicate: (services) =>
        services.length >= 1 &&
        services.every((service) => service.status.toLowerCase() !== "running"),
    });

    await page.getByRole("button", { name: "Start all" }).click();
    await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not restart after start-all",
      predicate: (services) =>
        services.length >= 1 &&
        services.every((service) => service.status.toLowerCase() !== "stopped"),
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
