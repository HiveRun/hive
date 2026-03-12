import { expect, type Page } from "@playwright/test";
import { selectors } from "./selectors";

const CELL_PATH_PATTERN = /^\/cells\/([^/]+)(?:\/.*)?$/;
const CELL_CHAT_PATH_PATTERN = /^\/cells\/([^/]+)\/chat$/;
const CELL_PROVISIONING_PATH_PATTERN = /^\/cells\/([^/]+)\/provisioning$/;
const POLL_INTERVAL_MS = 500;
const TERMINAL_RECOVERY_WAIT_MS = 750;
const MAX_TERMINAL_RESTARTS = 2;
const CELL_CREATION_TIMEOUT_MS = 120_000;
const CELL_FORM_VISIBLE_TIMEOUT_MS = 30_000;
const FORM_VISIBILITY_PROBE_TIMEOUT_MS = 1000;
const DEFAULT_CELL_STATUS_TIMEOUT_MS = 120_000;
const DEFAULT_SERVICE_STATUS_TIMEOUT_MS = 90_000;
const DEFAULT_ROUTE_TIMEOUT_MS = 180_000;
const INITIAL_CHAT_ROUTE_TIMEOUT_MS = 45_000;

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
  pid?: number;
  port?: number;
  cpuPercent?: number | null;
  rssBytes?: number | null;
  resourceUnavailableReason?: string;
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

type RpcErrorRecord = {
  message?: string;
  shortMessage?: string;
};

type RpcResult<T> =
  | { success: true; data: T }
  | { success: false; errors?: RpcErrorRecord[] };

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
  const pathname = readPathname(url);
  const cellId = extractCellIdFromPath(pathname);
  if (!cellId) {
    throw new Error(`Failed to parse cell ID from URL: ${url}`);
  }
  return cellId;
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
    readPathname(options.page.url())
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

    await options.page.waitForURL(
      (url) => {
        const currentCellId = extractCellIdFromPath(url.pathname);
        if (!currentCellId) {
          return false;
        }

        if (!previousCellId) {
          return true;
        }

        return currentCellId !== previousCellId;
      },
      { timeout: timeoutMs }
    );

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

    await options.page.goto(`/cells/${cellId}`);
    await options.page.waitForURL(
      (url) => extractCellIdFromPath(url.pathname) === cellId,
      { timeout: timeoutMs }
    );
    return cellId;
  }
}

function extractCellIdFromPath(pathname: string): string | null {
  const match = pathname.match(CELL_PATH_PATTERN);
  return match?.[1] ?? null;
}

function readPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function resolveCellSubroute(pathname: string, cellId: string) {
  const chatMatch = pathname.match(CELL_CHAT_PATH_PATTERN);
  if (chatMatch?.[1] === cellId) {
    return "chat" as const;
  }

  const provisioningMatch = pathname.match(CELL_PROVISIONING_PATH_PATTERN);
  if (provisioningMatch?.[1] === cellId) {
    return "provisioning" as const;
  }

  return null;
}

export async function waitForProvisioningOrChatRoute(options: {
  page: Page;
  cellId: string;
  timeoutMs?: number;
}): Promise<"chat" | "provisioning"> {
  const timeoutMs = options.timeoutMs ?? INITIAL_CHAT_ROUTE_TIMEOUT_MS;
  let resolvedRoute: "chat" | "provisioning" | null = null;

  await waitForCondition({
    timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach chat/provisioning route`,
    check: () => {
      const pathname = readPathname(options.page.url());
      resolvedRoute = resolveCellSubroute(pathname, options.cellId);
      return Promise.resolve(resolvedRoute !== null);
    },
  });

  if (!resolvedRoute) {
    throw new Error(
      `Failed to resolve route for cell ${options.cellId} after wait`
    );
  }

  return resolvedRoute;
}

export async function waitForChatRoute(options: {
  page: Page;
  cellId: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS;

  await waitForCondition({
    timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach chat route`,
    check: () =>
      Promise.resolve(
        readPathname(options.page.url()) === `/cells/${options.cellId}/chat`
      ),
  });
}

export async function createCellViaApi(options: {
  apiUrl: string;
  name: string;
  workspaceId?: string;
  templateLabel?: string;
  startMode?: "plan" | "build";
}): Promise<string> {
  const workspaceId = await resolveWorkspaceId(options);
  const templateId = await resolveTemplateId(options);
  const payload = await rpcRun<{ id?: string }>(options.apiUrl, {
    action: "create_cell",
    input: {
      name: options.name,
      templateId,
      workspaceId,
      ...(options.startMode ? { startMode: options.startMode } : {}),
    },
    fields: ["id"],
  });

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        "Failed to create cell via RPC"
    );
  }

  if (!payload.data.id) {
    throw new Error("Cell API response missing id");
  }

  return payload.data.id;
}

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
  const payload = await rpcRun<CellRecord | null>(apiUrl, {
    action: "get_cell",
    input: { id: cellId },
    fields: ["id", "workspaceId", "status", "lastSetupError"],
  });

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        `Failed to fetch cell ${cellId}`
    );
  }

  if (!payload.data) {
    throw new Error(`Cell ${cellId} not found`);
  }

  return payload.data;
}

export async function fetchServices(
  apiUrl: string,
  cellId: string,
  options: { includeResources?: boolean } = {}
): Promise<ServiceRecord[]> {
  const payload = await rpcRun<ServiceRecord[]>(apiUrl, {
    action: "list_services",
    input: {
      cellId,
      includeResources: options.includeResources ?? false,
    },
    fields: [
      "id",
      "name",
      "status",
      "pid",
      "port",
      "cpuPercent",
      "rssBytes",
      "resourceUnavailableReason",
    ],
  });

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        `Failed to fetch services for ${cellId}`
    );
  }

  return payload.data;
}

export async function fetchActivity(
  apiUrl: string,
  cellId: string
): Promise<ActivityRecord[]> {
  const payload = await rpcRun<ActivityRecord[]>(apiUrl, {
    action: "list_cell_activity",
    input: { cellId, limit: 200 },
    fields: ["id", "type"],
  });

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        `Failed to fetch activity for ${cellId}`
    );
  }

  return payload.data;
}

export async function fetchWorkspaces(
  apiUrl: string
): Promise<WorkspacesResponse> {
  const payload = await rpcRun<WorkspacesResponse["workspaces"][number][]>(
    apiUrl,
    {
      action: "list_workspaces",
      fields: ["id", "label", "path"],
    }
  );

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        "Failed to fetch workspaces"
    );
  }

  return {
    workspaces: payload.data,
    activeWorkspaceId: payload.data[0]?.id ?? null,
  };
}

export async function fetchWorkspaceCells(
  apiUrl: string,
  workspaceId: string
): Promise<CellRecord[]> {
  const payload = await rpcRun<CellRecord[]>(apiUrl, {
    action: "list_cells",
    input: { workspaceId },
    fields: ["id", "workspaceId", "status", "lastSetupError"],
  });

  if (!payload.success) {
    throw new Error(
      payload.errors?.[0]?.shortMessage ??
        payload.errors?.[0]?.message ??
        `Failed to fetch cells for workspace ${workspaceId}`
    );
  }

  return payload.data;
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
  includeResources?: boolean;
}): Promise<ServiceRecord[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SERVICE_STATUS_TIMEOUT_MS;
  let latest: ServiceRecord[] = [];

  try {
    await waitForCondition({
      timeoutMs,
      errorMessage: options.errorMessage,
      check: async () => {
        latest = await fetchServices(options.apiUrl, options.cellId, {
          includeResources: options.includeResources,
        });
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
        const [readySurfaceVisible, inputSurfaceVisible] = await Promise.all([
          page
            .locator(selectors.terminalReadySurface)
            .isVisible()
            .catch(() => false),
          page
            .locator(selectors.terminalInputSurface)
            .isVisible()
            .catch(() => false),
        ]);

        return readySurfaceVisible || inputSurfaceVisible;
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
  await page.keyboard.type(command, { delay: 25 });
  await page.keyboard.press("Enter");
}

export async function sendCellTerminalCommand(
  page: Page,
  command: string
): Promise<void> {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  const cellId = extractCellIdFromPath(readPathname(page.url()));

  if (apiUrl && cellId) {
    const response = await fetch(
      `${apiUrl}/api/cells/${cellId}/terminal/input`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: `${command}\n` }),
      }
    );

    if (response.ok) {
      return;
    }
  }

  await sendTerminalCommand(page, command);
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
