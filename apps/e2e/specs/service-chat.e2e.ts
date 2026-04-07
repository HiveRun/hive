import { expect, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  createCell,
  fetchAgentSession,
  waitForCellStatus,
  waitForChatRoute,
  waitForCondition,
  waitForProvisioningOrChatRoute,
  waitForServiceStatuses,
} from "../src/test-helpers";

const SERVICES_TEMPLATE_LABEL = "Hive Development Environment";
const INITIAL_ROUTE_TIMEOUT_MS = 45_000;
const READY_TIMEOUT_MS = 600_000;
const CHAT_TIMEOUT_MS = 180_000;
const OPCODE_COMMAND_TEXT = /opencode /i;

test.describe("service-backed chat", () => {
  test.describe.configure({ timeout: READY_TIMEOUT_MS });

  test("supports chat after service setup completes", async ({ page }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");

    const cellId = await createCell({
      page,
      name: `E2E Service Chat ${Date.now()}`,
      templateLabel: SERVICES_TEMPLATE_LABEL,
    });

    await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: INITIAL_ROUTE_TIMEOUT_MS,
    });

    await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: READY_TIMEOUT_MS,
    });

    await waitForServiceStatuses({
      apiUrl,
      cellId,
      timeoutMs: READY_TIMEOUT_MS,
      errorMessage: "Services did not become running before chat",
      predicate: (services) =>
        services.length >= 1 &&
        services.some((service) => service.status.toLowerCase() === "running"),
    });

    await page.goto(`/cells/${cellId}/chat`);
    await waitForChatRoute({ page, cellId, timeoutMs: CHAT_TIMEOUT_MS });

    const session = await waitForAgentSession(apiUrl, cellId);
    expect(session.id).toBeTruthy();
    await expect(page.locator(selectors.terminalRoot)).toBeVisible();
    await expect(page.getByText(OPCODE_COMMAND_TEXT).first()).toBeVisible();
  });
});

async function waitForAgentSession(apiUrl: string, cellId: string) {
  await waitForCondition({
    timeoutMs: CHAT_TIMEOUT_MS,
    errorMessage: `Agent session was not available for cell ${cellId}`,
    check: async () => Boolean(await fetchAgentSession(apiUrl, cellId)),
  });

  const session = await fetchAgentSession(apiUrl, cellId);
  if (!session) {
    throw new Error(`Agent session missing for cell ${cellId}`);
  }

  return session;
}
