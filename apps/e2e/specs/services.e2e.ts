import { expect, test } from "@playwright/test";
import {
  createCell,
  fetchActivity,
  waitForCondition,
  waitForServiceStatuses,
} from "../src/test-helpers";

const SERVICES_TEMPLATE_LABEL = "E2E Services Template";
const STOP_BUTTON_LABEL = /^Stop$/;
const START_BUTTON_LABEL = /^Start$/;
const isActiveStatus = (status: string) => {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "starting";
};

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

    const runningServices = await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: "Services did not become running after creation",
      predicate: (services) =>
        services.length >= 1 &&
        services.some((service) => service.status.toLowerCase() === "running"),
    });

    const targetService = runningServices[0];
    if (!targetService) {
      throw new Error("No service available to run single-service assertions");
    }

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: targetService.name }).click();

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
        services.some(
          (service) =>
            service.id === targetService.id && isActiveStatus(service.status)
        ),
    });

    await page.getByRole("button", { name: STOP_BUTTON_LABEL }).click();
    await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: `Service ${targetService.name} did not stop`,
      predicate: (services) =>
        services.some(
          (service) =>
            service.id === targetService.id &&
            service.status.toLowerCase() === "stopped"
        ),
    });

    await page.getByRole("button", { name: START_BUTTON_LABEL }).click();
    await waitForServiceStatuses({
      apiUrl,
      cellId,
      errorMessage: `Service ${targetService.name} did not start`,
      predicate: (services) =>
        services.some(
          (service) =>
            service.id === targetService.id && isActiveStatus(service.status)
        ),
    });

    await waitForCondition({
      timeoutMs: 30_000,
      errorMessage: "Expected service activity events were not recorded",
      check: async () => {
        const events = await fetchActivity(apiUrl, cellId);
        const eventTypes = new Set(events.map((event) => event.type));
        return (
          eventTypes.has("services.stop") &&
          eventTypes.has("services.start") &&
          eventTypes.has("service.stop") &&
          eventTypes.has("service.start")
        );
      },
    });

    const events = await fetchActivity(apiUrl, cellId);
    const eventTypes = new Set(events.map((event) => event.type));
    expect(eventTypes.has("services.stop")).toBe(true);
    expect(eventTypes.has("services.start")).toBe(true);
    expect(eventTypes.has("service.stop")).toBe(true);
    expect(eventTypes.has("service.start")).toBe(true);
  });
});
