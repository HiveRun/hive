import { expect, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  openCellCreationSheet,
  parseCellIdFromUrl,
  selectTemplate,
  waitForChatRoute,
  waitForProvisioningOrChatRoute,
} from "../src/test-helpers";

type AgentSession = {
  id?: string;
  modelId?: string;
  modelProviderId?: string;
};

type RpcResult<T> = {
  success: boolean;
  data: T;
  errors?: Array<{ message?: string; shortMessage?: string }>;
};

const CELL_TEMPLATE_LABEL = "E2E Template";
const EXPECTED_MODEL_LABEL = "Big Pickle";
const EXPECTED_MODEL_ID = "big-pickle";
const EXPECTED_MODEL_PROVIDER_ID = "opencode";
const CELL_URL_PATTERN = /\/cells\//;
const PROVISIONING_TIMELINE_TEXT = /Provisioning timeline/i;

test.describe("model catalog", () => {
  test("loads models in the UI and persists the selected default", async ({
    page,
  }) => {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw new Error("HIVE_E2E_API_URL is required for E2E tests");
    }

    await page.goto("/");
    await openCellCreationSheet(page);
    await page
      .locator(selectors.cellNameInput)
      .fill(`Model Catalog ${Date.now()}`);
    await selectTemplate(page, CELL_TEMPLATE_LABEL);

    const modelSelector = page.locator("#cell-model-selector");
    await expect(modelSelector).toContainText(EXPECTED_MODEL_LABEL, {
      timeout: 30_000,
    });
    await expect(modelSelector).toContainText("Zen", { timeout: 30_000 });

    await expect(page.locator(selectors.cellSubmitButton)).toBeEnabled({
      timeout: 30_000,
    });
    await page.locator(selectors.cellSubmitButton).click();

    await page.waitForURL(CELL_URL_PATTERN, { timeout: 120_000 });

    const cellId = parseCellIdFromUrl(page.url());

    const initialRoute = await waitForProvisioningOrChatRoute({
      page,
      cellId,
      timeoutMs: 45_000,
    });

    if (initialRoute === "provisioning") {
      await expect(page.getByText(PROVISIONING_TIMELINE_TEXT)).toBeVisible();
    }

    await waitForChatRoute({ page, cellId, timeoutMs: 180_000 });

    await expect
      .poll(async () => {
        const payload = await rpcRun<AgentSession | null>(apiUrl, {
          action: "get_agent_session_by_cell",
          input: { cellId },
          fields: ["id", "modelId", "modelProviderId"],
        });

        if (!(payload.success && payload.data?.id)) {
          return null;
        }

        return {
          modelId: payload.data.modelId,
          modelProviderId: payload.data.modelProviderId,
        };
      })
      .toEqual({
        modelId: EXPECTED_MODEL_ID,
        modelProviderId: EXPECTED_MODEL_PROVIDER_ID,
      });
  });
});

async function rpcRun<T>(
  apiUrl: string,
  payload: Record<string, unknown>
): Promise<RpcResult<T>> {
  const response = await fetch(`${apiUrl}/rpc/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  return (await response.json()) as RpcResult<T>;
}
