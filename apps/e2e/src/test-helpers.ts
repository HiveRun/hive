import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { wait as waitDelay } from "./runtime/wait";
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
const DEFAULT_RUNNING_SERVICE_COUNT = 3;
const DEFAULT_ROUTE_TIMEOUT_MS = 180_000;
const INITIAL_CHAT_ROUTE_TIMEOUT_MS = 45_000;

type CellRecord = {
  id: string;
  workspaceId: string;
  status: string;
  lastSetupError?: string | null;
};

type ServicePortRecord = {
  name: string;
  port: number;
  primary: boolean;
  protocol: "http" | "https" | "tcp";
  url?: string;
  portReachable: boolean;
};

type ServiceRecord = {
  audio?: { input?: boolean; output?: boolean };
  id: string;
  name: string;
  status: string;
  pid?: number;
  port?: number;
  url?: string;
  ports: ServicePortRecord[];
  env: Record<string, string>;
  cpuPercent?: number | null;
  rssBytes?: number | null;
  resourceUnavailableReason?: string;
};

type ActivityRecord = {
  id: string;
  type: string;
};

export type AgentSession = {
  id: string;
  modelId?: string;
  modelProviderId?: string;
  provider?: string;
  startMode?: "plan" | "build";
  currentMode?: "plan" | "build";
  status: string;
  updatedAt: string;
};

type AgentMessage = {
  id: string;
  role: string;
  state?: string;
  content: string | null;
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

type MessagePayload = { message: string };

function hasMessage(payload: unknown): payload is MessagePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  );
}

async function fetchJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${errorMessage}: ${response.status}`);
  }

  const payload = (await response.json()) as T | MessagePayload;
  if (hasMessage(payload)) {
    throw new Error(payload.message);
  }

  return payload;
}

export function requireApiUrl(
  message = "HIVE_E2E_API_URL is required for E2E tests"
) {
  const apiUrl = process.env.HIVE_E2E_API_URL;
  if (!apiUrl) {
    throw new Error(message);
  }
  return apiUrl;
}

export function requireCellPaths(cellId: string) {
  const hiveHome = process.env.HIVE_E2E_HIVE_HOME;
  if (!hiveHome) {
    throw new Error("HIVE_E2E_HIVE_HOME is required for E2E tests");
  }
  return {
    artifactsDir: join(hiveHome, "artifacts", "cells", cellId),
    runtimeDir: join(hiveHome, "runtime", "cells", cellId),
  };
}

export function readServicePortAssignments(services: ServiceRecord[]) {
  return services
    .flatMap((service) =>
      service.ports.map((port) => ({
        name: `${service.name}:${port.name}`,
        port: port.port,
      }))
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

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
    await waitDelay(intervalMs);
  }

  throw new Error(options.errorMessage);
}

function parseCellIdFromUrl(url: string): string {
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
  templateId?: string;
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
      templateId: options.templateId,
    });

    await options.page.goto(`/cells/${cellId}`);
    await options.page.waitForURL(
      (url) => extractCellIdFromPath(url.pathname) === cellId,
      { timeout: timeoutMs }
    );
    return cellId;
  }
}

export async function createCellFromHome(
  options: Parameters<typeof createCell>[0]
) {
  await options.page.goto("/");
  return await createCell(options);
}

export const createRunningServicesCell = async (
  page: Page,
  apiUrl: string,
  options: {
    name?: string;
    errorMessage?: string;
    predicate?: (services: ServiceRecord[]) => boolean;
    timeoutMs?: number;
  } = {}
) => {
  const cellId = await createCellFromHome({
    page,
    name: options.name ?? `E2E Services ${Date.now()}`,
    templateLabel: "E2E Services Template",
  });
  await page.goto(`/cells/${cellId}/services`);
  const services = await waitForServiceStatuses({
    apiUrl,
    cellId,
    timeoutMs: options.timeoutMs,
    errorMessage:
      options.errorMessage ?? "Three services did not become running",
    predicate:
      options.predicate ??
      ((records) =>
        records.length === DEFAULT_RUNNING_SERVICE_COUNT &&
        records.every((service) => service.status.toLowerCase() === "running")),
  });
  return { cellId, services };
};

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extractCellIdFromPath(pathname: string): string | null {
  const match = pathname.match(CELL_PATH_PATTERN);
  return match?.[1] ?? null;
}

function readPathname(url: string): string {
  if (URL.canParse(url)) {
    return new URL(url).pathname;
  }
  return url;
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
  const apiUrl = process.env.HIVE_E2E_API_URL;
  let lastPath = "unknown";
  let lastStatus = "unknown";

  await waitForCondition({
    timeoutMs,
    errorMessage: `Cell ${options.cellId} did not reach chat route. lastPath=${lastPath} lastStatus=${lastStatus}`,
    check: async () => {
      lastPath = readPathname(options.page.url());

      if (!apiUrl) {
        return lastPath === `/cells/${options.cellId}/chat`;
      }

      const cell = await fetchCell(apiUrl, options.cellId);
      lastStatus = cell.status;

      if (cell.status === "error") {
        throw new Error(
          `Cell ${options.cellId} entered error status while waiting for chat route: ${cell.lastSetupError ?? "setup failed"}`
        );
      }

      if (
        lastPath === `/cells/${options.cellId}/chat` &&
        cell.status === "ready"
      ) {
        return true;
      }

      if (cell.status === "ready") {
        await options.page.goto(`/cells/${options.cellId}/chat`);
      }

      return false;
    },
  });
}

export async function createCellViaApi(options: {
  apiUrl: string;
  name: string;
  workspaceId?: string;
  templateLabel?: string;
  templateId?: string;
  startMode?: "plan" | "build";
}): Promise<string> {
  const workspaceId = await resolveWorkspaceId(options);
  const templateId = options.templateId ?? (await resolveTemplateId(options));
  const response = await fetch(`${options.apiUrl}/api/cells`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      templateId,
      workspaceId,
      ...(options.startMode ? { startMode: options.startMode } : {}),
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

export async function createApiCellAndOpenChat(options: {
  page: Page;
  apiUrl: string;
  name: string;
  templateLabel?: string;
  startMode?: "plan" | "build";
  initialRouteTimeoutMs: number;
  chatRouteTimeoutMs?: number;
}): Promise<{ cellId: string; initialRoute: "chat" | "provisioning" }> {
  await options.page.goto("/");
  const cellId = await createCellViaApi({
    apiUrl: options.apiUrl,
    name: options.name,
    templateLabel: options.templateLabel,
    startMode: options.startMode,
  });

  await options.page.goto(`/cells/${cellId}/chat`);
  const initialRoute = await waitForProvisioningOrChatRoute({
    page: options.page,
    cellId,
    timeoutMs: options.initialRouteTimeoutMs,
  });

  if (options.chatRouteTimeoutMs) {
    await waitForChatRoute({
      page: options.page,
      cellId,
      timeoutMs: options.chatRouteTimeoutMs,
    });
  }

  return { cellId, initialRoute };
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

async function openCellCreationSheet(
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

async function selectTemplate(page: Page, label: string): Promise<void> {
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
  return await fetchJson<CellRecord>(
    `${apiUrl}/api/cells/${cellId}`,
    `Failed to fetch cell ${cellId}`
  );
}

async function fetchServices(
  apiUrl: string,
  cellId: string,
  options: { includeResources?: boolean } = {}
): Promise<ServiceRecord[]> {
  const params = new URLSearchParams();
  if (options.includeResources) {
    params.set("includeResources", "true");
  }
  const query = params.toString();
  const payload = await fetchJson<{ services: ServiceRecord[] }>(
    `${apiUrl}/api/cells/${cellId}/services${query ? `?${query}` : ""}`,
    `Failed to fetch services for ${cellId}`
  );
  return payload.services;
}

async function fetchActivity(
  apiUrl: string,
  cellId: string
): Promise<ActivityRecord[]> {
  const payload = await fetchJson<{ events: ActivityRecord[] }>(
    `${apiUrl}/api/cells/${cellId}/activity?limit=200`,
    `Failed to fetch activity for ${cellId}`
  );
  return payload.events;
}

export async function waitForActivityTypes(options: {
  apiUrl: string;
  cellId: string;
  types: readonly string[];
  timeoutMs: number;
  errorMessage: string;
}): Promise<ActivityRecord[]> {
  let latest: ActivityRecord[] = [];
  await waitForCondition({
    timeoutMs: options.timeoutMs,
    errorMessage: options.errorMessage,
    check: async () => {
      latest = await fetchActivity(options.apiUrl, options.cellId);
      const eventTypes = new Set(latest.map((event) => event.type));
      return options.types.every((type) => eventTypes.has(type));
    },
  });
  return latest;
}

export async function fetchWorkspaces(
  apiUrl: string
): Promise<WorkspacesResponse> {
  return await fetchJson<WorkspacesResponse>(
    `${apiUrl}/api/workspaces`,
    "Failed to fetch workspaces"
  );
}

export async function fetchWorkspaceCells(
  apiUrl: string,
  workspaceId: string
): Promise<CellRecord[]> {
  const payload = await fetchJson<{ cells: CellRecord[] }>(
    `${apiUrl}/api/cells?workspaceId=${workspaceId}`,
    `Failed to fetch cells for workspace ${workspaceId}`
  );
  return payload.cells;
}

export async function fetchAgentSession(
  apiUrl: string,
  cellId: string
): Promise<AgentSession | null> {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/byCell/${cellId}`
  );
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { session: AgentSession | null };
  return payload.session;
}

export async function fetchAgentMessages(
  apiUrl: string,
  sessionId: string
): Promise<AgentMessage[]> {
  const response = await fetch(
    `${apiUrl}/api/agents/sessions/${sessionId}/messages`
  );
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { messages?: AgentMessage[] };
  return payload.messages ?? [];
}

export async function fetchAgentMessageIds(
  apiUrl: string,
  sessionId: string
): Promise<Set<string>> {
  const messages = await fetchAgentMessages(apiUrl, sessionId);
  return new Set(messages.map((message) => message.id));
}

export async function waitForAgentSession(options: {
  apiUrl: string;
  cellId: string;
  timeoutMs: number;
  errorMessage?: string;
}): Promise<AgentSession> {
  await waitForCondition({
    check: async () =>
      Boolean(await fetchAgentSession(options.apiUrl, options.cellId)),
    errorMessage:
      options.errorMessage ??
      "Agent session was not available for the created cell",
    timeoutMs: options.timeoutMs,
  });

  const session = await fetchAgentSession(options.apiUrl, options.cellId);
  if (!session) {
    throw new Error("Agent session missing after successful wait");
  }
  return session;
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
      const badge = page.locator(selectors.terminalConnectionBadge).first();
      const terminalRoot = page.locator(selectors.terminalRoot).first();
      const [badgeCount, terminalRootCount] = await Promise.all([
        badge.count(),
        terminalRoot.count(),
      ]);

      if (badgeCount === 0 || terminalRootCount === 0) {
        lastState = "missing";
        lastExitCode = "";
        return false;
      }

      const [state, exitCode] = await Promise.all([
        badge.getAttribute("data-connection-state", { timeout: 1000 }),
        badge.getAttribute("data-exit-code", { timeout: 1000 }),
      ]);

      lastState = state ?? "unknown";
      lastExitCode = exitCode ?? "";

      if (state === "online") {
        return page.locator(selectors.terminalInputTextarea).isVisible();
      }

      if (state === "exited") {
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
  await focusTerminalInput(page);
  await page.keyboard.type(command, { delay: 25 });
  await page.keyboard.press("Enter");
}

export async function focusTerminalInput(
  page: Page,
  timeoutMs?: number
): Promise<void> {
  await page.locator(selectors.terminalInputSurface).click();
  await page.locator(selectors.terminalInputTextarea).click();

  if (timeoutMs) {
    await waitForCondition({
      check: async () =>
        page.evaluate(() => {
          const active = document.activeElement;
          return active?.classList.contains("xterm-helper-textarea") ?? false;
        }),
      errorMessage: "Terminal input textarea did not receive focus",
      timeoutMs,
    });
  }
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

export function sendChatTerminalInput(
  apiUrl: string,
  cellId: string,
  data: string
): Promise<Response> {
  return fetch(`${apiUrl}/api/cells/${cellId}/chat/terminal/input`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
}

export async function readTerminalOutputSeq(page: Page): Promise<number> {
  const outputSeqRaw = await page
    .locator(selectors.terminalRoot)
    .getAttribute("data-terminal-output-seq");
  return Number(outputSeqRaw ?? "0");
}

export async function waitForTerminalOutputAdvance(
  page: Page,
  baseline: number,
  timeoutMs: number,
  errorMessage: string
): Promise<void> {
  await waitForCondition({
    check: async () => (await readTerminalOutputSeq(page)) > baseline,
    errorMessage,
    timeoutMs,
  });
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
  await wait(POLL_INTERVAL_MS);
}

export async function wait(ms: number): Promise<void> {
  await waitDelay(ms);
}
