import { expect, test } from "@playwright/test";
import {
  createCell,
  waitForCellStatus,
  waitForCondition,
  waitForProvisioningOrChatRoute,
  waitForServiceStatuses,
} from "../src/test-helpers";

const SERVICES_TEMPLATE_LABEL = "Hive Development Environment";
const DELETE_PROPAGATION_TIMEOUT_MS = 30_000;
const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const CHAT_ROUTE_TIMEOUT_MS = 600_000;
const PROVISIONING_TIMELINE_TEXT = /Provisioning timeline/i;
const DELETE_CELL_BUTTON_LABEL = /^Delete E2E Cleanup/;
const DELETE_CONFIRM_BUTTON_LABEL = /^Delete$/;
const SERVICE_NOT_FOUND_STATUS = 404;

test.describe("cell deletion cleanup", () => {
  test.describe.configure({ timeout: CHAT_ROUTE_TIMEOUT_MS });

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

    const initialRoute = await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    if (initialRoute === "provisioning") {
      await expect(page.getByText(PROVISIONING_TIMELINE_TEXT)).toBeVisible();
    }

    await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: CHAT_ROUTE_TIMEOUT_MS,
    });

    await page.goto(`/cells/${cellId}/services`);

    await waitForServiceStatuses({
      apiUrl,
      cellId,
      timeoutMs: 120_000,
      errorMessage: "Services did not become running before delete",
      predicate: (services) =>
        services.length > 0 &&
        services.some((service) => service.status.toLowerCase() === "running"),
    });

    const deleteButton = page.getByRole("button", {
      name: DELETE_CELL_BUTTON_LABEL,
    });

    await deleteButton.click();
    await page
      .getByRole("button", { name: DELETE_CONFIRM_BUTTON_LABEL })
      .click();

    await waitForCondition({
      timeoutMs: DELETE_PROPAGATION_TIMEOUT_MS,
      errorMessage: "Cell record still exists after deletion",
      check: async () => {
        const response = await fetch(`${apiUrl}/api/cells/${cellId}`);
        return response.status === SERVICE_NOT_FOUND_STATUS;
      },
    });

    await waitForCondition({
      timeoutMs: DELETE_PROPAGATION_TIMEOUT_MS,
      errorMessage: "Service endpoint still returns data after cell deletion",
      check: async () => {
        const response = await fetch(`${apiUrl}/api/cells/${cellId}/services`);
        return response.status === SERVICE_NOT_FOUND_STATUS;
      },
    });
  });
});
