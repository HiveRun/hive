import { expect, test } from "@playwright/test";
import {
  createCell,
  waitForChatRoute,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

const INITIAL_ROUTE_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 180_000;
const DETACHED_TEMPLATE_LABEL = "Basic Template";

test.describe("detached cell create", () => {
  test("returns to a cell route before provisioning completes", async ({
    page,
  }) => {
    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `Detached Create ${Date.now()}`,
      templateLabel: DETACHED_TEMPLATE_LABEL,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    const initialRoute = await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    expect(["provisioning", "chat"]).toContain(initialRoute);

    await waitForChatRoute({
      page,
      cellId,
      timeoutMs: READY_TIMEOUT_MS,
    });
  });
});
