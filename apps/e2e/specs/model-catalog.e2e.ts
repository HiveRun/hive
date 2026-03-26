import { expect, test } from "@playwright/test";
import { selectors } from "../src/selectors";
import {
  fetchAgentModels,
  fetchWorkspaces,
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

const CELL_TEMPLATE_LABEL = "Basic Template";
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
    const workspaces = await fetchWorkspaces(apiUrl);
    const workspaceId =
      workspaces.activeWorkspaceId ?? workspaces.workspaces[0]?.id ?? null;

    if (!workspaceId) {
      throw new Error("No active workspace available for model catalog E2E");
    }

    const modelsPayload = await fetchAgentModels(apiUrl, workspaceId);
    const expectedProviderId =
      Object.keys(modelsPayload.defaults)[0] ??
      modelsPayload.models[0]?.provider ??
      null;
    const expectedModelId =
      (expectedProviderId
        ? modelsPayload.defaults[expectedProviderId]
        : null) ??
      modelsPayload.models.find(
        (model) => model.provider === expectedProviderId
      )?.id ??
      modelsPayload.models[0]?.id ??
      null;
    const expectedModelLabel =
      modelsPayload.models.find(
        (model) =>
          model.provider === expectedProviderId && model.id === expectedModelId
      )?.name ?? null;

    if (!(expectedProviderId && expectedModelId && expectedModelLabel)) {
      throw new Error(
        "Could not determine expected model catalog defaults for strict E2E"
      );
    }

    await openCellCreationSheet(page);
    await page
      .locator(selectors.cellNameInput)
      .fill(`Model Catalog ${Date.now()}`);
    await selectTemplate(page, CELL_TEMPLATE_LABEL);

    const modelSelector = page.locator("#cell-model-selector");
    await modelSelector.click();
    await page.getByRole("option", { name: expectedModelLabel }).click();
    await expect(modelSelector).toContainText(expectedModelLabel, {
      timeout: 30_000,
    });

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
        modelId: expectedModelId,
        modelProviderId: expectedProviderId,
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
