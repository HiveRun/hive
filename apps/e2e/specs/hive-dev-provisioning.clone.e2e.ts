import { expect, test } from "@playwright/test";
import { readProcessTable } from "../src/runtime/process";
import {
  createCellViaApi,
  fetchCell,
  fetchWorkspaces,
  isPidAlive,
  requireApiUrl,
  waitForCellStatus,
  waitForCondition,
  waitForServiceStatuses,
} from "../src/test-helpers";

const DEFAULT_TEMPLATE_ID = "hive-dev";
const MINIMUM_READY_TIMEOUT_MS = 30_000;
const PROVISIONING_TIMEOUT_MS = 720_000;
const CLEANUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_OVERHEAD_MS = 60_000;
const ENDPOINT_PROBE_TIMEOUT_MS = 1000;
const NOT_FOUND_STATUS = 404;

type TemplateListResponse = {
  defaults?: { templateId?: string };
  templates: Array<{
    id: string;
    configJson: {
      services?: Record<string, { type: string; readyTimeoutMs?: number }>;
    };
  }>;
};

test("provisions and deletes the cloned workspace's default hive-dev cell", async () => {
  test.setTimeout(
    PROVISIONING_TIMEOUT_MS + CLEANUP_TIMEOUT_MS + TEST_TIMEOUT_OVERHEAD_MS
  );

  const apiUrl = requireApiUrl();
  const workspacePath = process.env.HIVE_E2E_WORKSPACE_PATH;
  if (!workspacePath) {
    throw new Error("HIVE_E2E_WORKSPACE_PATH is required for E2E tests");
  }

  const workspaces = await fetchWorkspaces(apiUrl);
  const workspace = workspaces.workspaces.find(
    (candidate) => candidate.path === workspacePath
  );
  expect(workspace, `Workspace not registered: ${workspacePath}`).toBeDefined();
  if (!workspace) {
    return;
  }

  const templatesResponse = await fetch(
    `${apiUrl}/api/templates?workspaceId=${workspace.id}`
  );
  expect(templatesResponse.ok).toBe(true);
  const templateList = (await templatesResponse.json()) as TemplateListResponse;
  expect(templateList.defaults?.templateId).toBe(DEFAULT_TEMPLATE_ID);

  const defaultTemplate = templateList.templates.find(
    (template) => template.id === DEFAULT_TEMPLATE_ID
  );
  expect(defaultTemplate).toBeDefined();
  const processServices = Object.entries(
    defaultTemplate?.configJson.services ?? {}
  ).filter(([, service]) => service.type === "process");
  expect(processServices.map(([name]) => name).sort()).toEqual([
    "server",
    "web",
  ]);
  for (const [, service] of processServices) {
    expect(service.readyTimeoutMs).toBeGreaterThanOrEqual(
      MINIMUM_READY_TIMEOUT_MS
    );
  }

  let cellId: string | undefined;
  let cellWorkspacePath: string | undefined;
  let servicePids: number[] = [];
  const serviceUrls: string[] = [];
  try {
    cellId = await createCellViaApi({
      apiUrl,
      name: `Hive Dev Parity ${Date.now()}`,
      templateId: DEFAULT_TEMPLATE_ID,
      workspaceId: workspace.id,
    });
    cellWorkspacePath = (await fetchCell(apiUrl, cellId)).workspacePath;

    const services = await waitForServiceStatuses({
      apiUrl,
      cellId,
      timeoutMs: PROVISIONING_TIMEOUT_MS,
      errorMessage: "Real hive-dev services did not become running",
      predicate: (records) =>
        records.length === processServices.length &&
        records.every(
          (service) =>
            service.status === "running" &&
            service.ports.some((port) => port.primary && port.portReachable)
        ),
    });
    await waitForCellStatus({
      apiUrl,
      cellId,
      status: "ready",
      timeoutMs: PROVISIONING_TIMEOUT_MS,
    });

    expect(services.map((service) => service.name).sort()).toEqual([
      "server",
      "web",
    ]);
    for (const service of services) {
      expect(service.url, `${service.name} URL`).toBeTruthy();
      if (!service.url) {
        throw new Error(`${service.name} URL is unavailable`);
      }
      serviceUrls.push(service.url);
      const response = await fetch(service.url);
      expect(response.ok, `${service.name} HTTP endpoint`).toBe(true);
    }
    servicePids = services
      .map((service) => service.pid)
      .filter((pid): pid is number => typeof pid === "number");
    expect(servicePids).toHaveLength(processServices.length);
  } finally {
    if (cellId) {
      await deleteCellAndWaitForCleanup({
        apiUrl,
        cellId,
        cellWorkspacePath,
        servicePids,
        serviceUrls,
      });
    }
  }
});

async function deleteCellAndWaitForCleanup(options: {
  apiUrl: string;
  cellId: string;
  cellWorkspacePath?: string;
  servicePids: number[];
  serviceUrls: string[];
}): Promise<void> {
  const response = await fetch(
    `${options.apiUrl}/api/cells/${options.cellId}`,
    {
      method: "DELETE",
    }
  );
  expect(response.ok).toBe(true);

  await waitForCondition({
    timeoutMs: CLEANUP_TIMEOUT_MS,
    errorMessage: "Real hive-dev cell record still exists after deletion",
    check: async () =>
      (await fetch(`${options.apiUrl}/api/cells/${options.cellId}`)).status ===
      NOT_FOUND_STATUS,
  });
  await waitForCondition({
    timeoutMs: CLEANUP_TIMEOUT_MS,
    errorMessage: "Real hive-dev service process still exists after deletion",
    check: () =>
      Promise.resolve(options.servicePids.every((pid) => !isPidAlive(pid))),
  });
  await waitForCondition({
    timeoutMs: CLEANUP_TIMEOUT_MS,
    errorMessage:
      "Real hive-dev service endpoint still responds after deletion",
    check: () => areEndpointsUnreachable(options.serviceUrls),
  });
  const cellWorkspacePath = options.cellWorkspacePath;
  if (cellWorkspacePath) {
    await waitForCondition({
      timeoutMs: CLEANUP_TIMEOUT_MS,
      errorMessage: "Process still references the deleted hive-dev worktree",
      check: () =>
        Promise.resolve(
          readProcessTable().every(
            (entry) => !entry.args.includes(cellWorkspacePath)
          )
        ),
    });
  }
}

async function areEndpointsUnreachable(urls: string[]): Promise<boolean> {
  const unreachable = await Promise.all(
    urls.map(async (url) => {
      try {
        await fetch(url, {
          signal: AbortSignal.timeout(ENDPOINT_PROBE_TIMEOUT_MS),
        });
        return false;
      } catch {
        return true;
      }
    })
  );
  return unreachable.every(Boolean);
}
