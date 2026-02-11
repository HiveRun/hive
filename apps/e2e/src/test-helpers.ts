import { expect, type Page } from "@playwright/test";
import { selectors } from "./selectors";

const CELL_CHAT_URL_PATTERN = /\/cells\/[^/]+\/chat/;
const CELL_ID_PATTERN = /\/cells\/([^/]+)\/chat/;
const CELL_CHAT_PATH_PATTERN = /^\/cells\/([^/]+)\/chat$/;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const MAX_TERMINAL_RESTARTS = 2;
const CELL_CREATION_TIMEOUT_MS = 120_000;
const CELL_FORM_VISIBLE_TIMEOUT_MS = 30_000;
const FORM_VISIBILITY_PROBE_TIMEOUT_MS = 1000;
const DEFAULT_CELL_STATUS_TIMEOUT_MS = 120_000;
const DEFAULT_SERVICE_STATUS_TIMEOUT_MS = 90_000;

type CellRecord = {
  id: string;
  workspaceId: string;
  status: string;
  lastSetupError?: string | null;
};

type ServiceRecord = {
  id: string;
  name: string;
  status: string;
};

type ActivityRecord = {
  id: string;
  type: string;
};

type WorkspacesResponse = {
  workspaces: Array<{
    id: string;
    label: string;
    path: string;
  }>;
  activeWorkspaceId?: string | null;
};

type TemplateRecord = {
  id: string;
  label: string;
};

export async function waitForCondition(options: {
  check: () => Promise<boolean>;
  errorMessage: string;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (await options.check()) {
      return;
    }
    await wait(intervalMs);
  }

  throw new Error(options.errorMessage);
}

export function parseCellIdFromUrl(url: string): string {
  const match = url.match(CELL_ID_PATTERN);
  if (!match?.[1]) {
    throw new Error(`Failed to parse cell ID from URL: ${url}`);
  }
  return match[1];
}

export async function createCell(options: {
  page: Page;
  name: string;
  workspaceId?: string;
  templateLabel?: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? CELL_CREATION_TIMEOUT_MS;
  const previousCellId = extractCellIdFromPath(
    new URL(options.page.url()).pathname
  );

  try {
    await openCellCreationSheet(options.page, options.workspaceId);
    await options.page.locator(selectors.cellNameInput).fill(options.name);

    if (options.templateLabel) {
      await selectTemplate(options.page, options.templateLabel);
    }

    await expect(options.page.locator(selectors.cellSubmitButton)).toBeEnabled({
      timeout: timeoutMs,
    });
    await options.page.locator(selectors.cellSubmitButton).click();

    if (previousCellId) {
      await options.page.waitForURL(
        (url) => {
          const currentCellId = extractCellIdFromPath(url.pathname);
          return currentCellId !== null && currentCellId !== previousCellId;
        },
        { timeout: timeoutMs }
      );
    } else {
      await expect(options.page).toHaveURL(CELL_CHAT_URL_PATTERN, {
        timeout: timeoutMs,
      });
    }

    return parseCellIdFromUrl(options.page.url());
  } catch (error) {
    const apiUrl = process.env.HIVE_E2E_API_URL;
    if (!apiUrl) {
      throw error;
    }

    const cellId = await createCellViaApi({
      apiUrl,
      name: options.name,
      workspaceId: options.workspaceId,
      templateLabel: options.templateLabel,
    });

    await options.page.goto(`/cells/${cellId}/chat`);
    return cellId;
  }
}

function extractCellIdFromPath(pathname: string): string | null {
  const match = pathname.match(CELL_CHAT_PATH_PATTERN);
  return match?.[1] ?? null;
}

async function createCellViaApi(options: {
  apiUrl: string;
  name: string;
  workspaceId?: string;
  templateLabel?: string;
}): Promise<string> {
  const workspaceId = await resolveWorkspaceId(options);
  const templateId = await resolveTemplateId(options);
  const response = await fetch(`${options.apiUrl}/api/cells`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      templateId,
      workspaceId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create cell via API: ${response.status}`);
  }

  const payload = (await response.json()) as { id?: string; message?: string };
  if (payload.message) {
    throw new Error(payload.message);
  }
  if (!payload.id) {
    throw new Error("Cell API response missing id");
  }

  return payload.id;
}

async function resolveWorkspaceId(options: {
  apiUrl: string;
  workspaceId?: string;
}): Promise<string> {
  if (options.workspaceId) {
    return options.workspaceId;
  }

  const workspaces = await fetchWorkspaces(options.apiUrl);
  const fallbackId =
    workspaces.activeWorkspaceId ?? workspaces.workspaces[0]?.id ?? null;
  if (!fallbackId) {
    throw new Error("No workspace available for API cell creation");
  }

  return fallbackId;
}

async function resolveTemplateId(options: {
  apiUrl: string;
  workspaceId?: string;
  templateLabel?: string;
}): Promise<string> {
  if (!options.templateLabel) {
    return "e2e-template";
  }

  const params = new URLSearchParams();
  if (options.workspaceId) {
    params.set("workspaceId", options.workspaceId);
  }

  const response = await fetch(
    `${options.apiUrl}/api/templates${params.size ? `?${params.toString()}` : ""}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.status}`);
  }

  const payload = (await response.json()) as {
    templates?: TemplateRecord[];
    message?: string;
  };
  if (payload.message && !payload.templates) {
    throw new Error(payload.message);
  }

  const templates = payload.templates ?? [];
  const match = templates.find(
    (template) => template.label === options.templateLabel
  );
  if (!match) {
    throw new Error(`Template not found: ${options.templateLabel}`);
  }

  return match.id;
}

export async function openCellCreationSheet(
  page: Page,
  workspaceId?: string
): Promise<void> {
  await maybeRecoverRouteError(page);

  if (workspaceId) {
    const workspaceCreateButton = page.locator(
      `${selectors.workspaceSection}[data-workspace-id="${workspaceId}"] ${selectors.workspaceCreateCellButton}`
    );
    await workspaceCreateButton.first().waitFor({
      state: "visible",
      timeout: CELL_CREATION_TIMEOUT_MS,
    });
    await workspaceCreateButton.first().click();
    await page.locator(selectors.cellNameInput).waitFor({
      state: "visible",
      timeout: CELL_FORM_VISIBLE_TIMEOUT_MS,
    });
    return;
  }

  const createCellButtons = page.locator(selectors.workspaceCreateCellButton);
  await createCellButtons.first().waitFor({
    state: "visible",
    timeout: CELL_CREATION_TIMEOUT_MS,
  });
  const buttonCount = await createCellButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    try {
      await createCellButtons.nth(index).click({ timeout: 15_000 });
    } catch {
      await maybeRecoverRouteError(page);
      continue;
    }

    const formVisible = await page
      .locator(selectors.cellNameInput)
      .isVisible({ timeout: FORM_VISIBILITY_PROBE_TIMEOUT_MS })
      .catch(() => false);

    if (formVisible) {
      return;
    }

    await maybeRecoverRouteError(page);
  }

  throw new Error("Failed to open create-cell form for any workspace");
}

export async function selectTemplate(page: Page, label: string): Promise<void> {
  const trigger = page.locator(selectors.templateSelectTrigger);
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.click({ noWaitAfter: true });

  const option = page.getByRole("option", { name: label });
  const target = option.first();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  try {
    await target.click({ noWaitAfter: true, timeout: 15_000 });
  } catch {
    await target.click({ force: true, noWaitAfter: true });
  }
}

export async function fetchCell(
  apiUrl: string,
  cellId: string
): Promise<CellRecord> {
  const response = await fetch(`${apiUrl}/api/cells/${cellId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch cell ${cellId}: ${response.status}`);
  }
  const payload = (await response.json()) as CellRecord | { message: string };
  if ("message" in payload) {
    throw new Error(payload.message);
  }
  return payload;
}

export async function fetchServices(
  apiUrl: string,
  cellId: string
): Promise<ServiceRecord[]> {
  const response = await fetch(`${apiUrl}/api/cells/${cellId}/services`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch services for ${cellId}: ${response.status}`
    );
  }

  const payload = (await response.json()) as
    | { services: ServiceRecord[] }
    | { message: string };
  if ("message" in payload) {
    throw new Error(payload.message);
  }

  return payload.services;
}

export async function fetchActivity(
  apiUrl: string,
  cellId: string
): Promise<ActivityRecord[]> {
  const response = await fetch(
    `${apiUrl}/api/cells/${cellId}/activity?limit=200`
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch activity for ${cellId}: ${response.status}`
    );
  }

  const payload = (await response.json()) as
    | { events: ActivityRecord[] }
    | { message: string };
  if ("message" in payload) {
    throw new Error(payload.message);
  }

  return payload.events;
}

export async function fetchWorkspaces(
  apiUrl: string
): Promise<WorkspacesResponse> {
  const response = await fetch(`${apiUrl}/api/workspaces`);
  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  const payload = (await response.json()) as
    | WorkspacesResponse
    | { message: string };
  if ("message" in payload) {
    throw new Error(payload.message);
  }

  return payload;
}

export async function fetchWorkspaceCells(
  apiUrl: string,
  workspaceId: string
): Promise<CellRecord[]> {
  const response = await fetch(
    `${apiUrl}/api/cells?workspaceId=${workspaceId}`
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch cells for workspace ${workspaceId}: ${response.status}`
    );
  }

  const payload = (await response.json()) as
    | { cells: CellRecord[] }
    | { message: string };
  if ("message" in payload) {
    throw new Error(payload.message);
  }

  return payload.cells;
}

export async function waitForCellStatus(options: {
  apiUrl: string;
  cellId: string;
  status: string;
  timeoutMs?: number;
}): Promise<CellRecord> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CELL_STATUS_TIMEOUT_MS;
  let latest: CellRecord | null = null;

  await waitForCondition({
    timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach status ${options.status}`,
    check: async () => {
      latest = await fetchCell(options.apiUrl, options.cellId);
      return latest.status === options.status;
    },
  });

  if (!latest) {
    throw new Error(`Cell ${options.cellId} status polling failed`);
  }

  return latest;
}

export async function waitForServiceStatuses(options: {
  apiUrl: string;
  cellId: string;
  predicate: (services: ServiceRecord[]) => boolean;
  timeoutMs?: number;
  errorMessage: string;
}): Promise<ServiceRecord[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SERVICE_STATUS_TIMEOUT_MS;
  let latest: ServiceRecord[] = [];

  try {
    await waitForCondition({
      timeoutMs,
      errorMessage: options.errorMessage,
      check: async () => {
        latest = await fetchServices(options.apiUrl, options.cellId);
        return options.predicate(latest);
      },
    });
  } catch {
    const statusSnapshot = latest
      .map((service) => `${service.name}:${service.status}`)
      .join(", ");
    throw new Error(
      `${options.errorMessage}. Latest statuses: ${statusSnapshot || "none"}`
    );
  }

  return latest;
}

export async function ensureTerminalReady(
  page: Page,
  options: {
    context: string;
    timeoutMs: number;
  }
): Promise<void> {
  let restartCount = 0;
  let lastState = "unknown";
  let lastExitCode = "";

  await waitForCondition({
    timeoutMs: options.timeoutMs,
    errorMessage: `Terminal not ready during ${options.context}. Last state=${lastState} exitCode=${lastExitCode || "n/a"}`,
    check: async () => {
      const badge = page.locator(selectors.terminalConnectionBadge);
      const [state, exitCode] = await Promise.all([
        badge.getAttribute("data-connection-state"),
        badge.getAttribute("data-exit-code"),
      ]);

      lastState = state ?? "unknown";
      lastExitCode = exitCode ?? "";

      if (state === "online") {
        return page.locator(selectors.terminalInputTextarea).isVisible();
      }

      if (state === "exited" || state === "disconnected") {
        if (restartCount >= MAX_TERMINAL_RESTARTS) {
          throw new Error(
            `Terminal remained ${state} during ${options.context}. exitCode=${lastExitCode || "n/a"}`
          );
        }

        await page.locator(selectors.terminalRestartButton).click();
        restartCount += 1;
        await page.waitForTimeout(TERMINAL_RECOVERY_WAIT_MS);
      }

      return false;
    },
  });
}

export async function sendTerminalCommand(
  page: Page,
  command: string
): Promise<void> {
  await page.locator(selectors.terminalInputSurface).click();
  await page.locator(selectors.terminalInputTextarea).focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function maybeRecoverRouteError(page: Page): Promise<void> {
  const tryAgainButton = page.getByRole("button", { name: "Try again" });
  const isVisible = await tryAgainButton
    .isVisible({ timeout: 500 })
    .catch(() => false);

  if (!isVisible) {
    return;
  }

  await tryAgainButton.click();
  await page.waitForTimeout(POLL_INTERVAL_MS);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
