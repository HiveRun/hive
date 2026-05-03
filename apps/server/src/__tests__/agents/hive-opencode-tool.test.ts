import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  rerun_setup as hiveRerunSetupTool,
  restart_services as hiveRestartServicesTool,
  restart_service as hiveRestartServiceTool,
  services as hiveServicesTool,
} from "../../agents/tools/hive";

const TEST_SERVICE_PORT = 39_993;
const HTTP_OK = 200;
const RESTART_ALL_FETCH_CALLS = 2;
const RESTART_SINGLE_FETCH_CALLS = 3;

function resolveFetchUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input && typeof input === "object" && "url" in input) {
    const url = (input as { url?: unknown }).url;
    if (typeof url === "string") {
      return url;
    }
  }
  throw new Error("Unexpected fetch input");
}

async function createTempWorktree(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), "hive-tool-test-"));
}

async function writeHiveToolConfig(args: {
  worktreePath: string;
  cellId: string;
  hiveUrl: string;
}): Promise<void> {
  const dir = join(args.worktreePath, ".hive");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({ cellId: args.cellId, hiveUrl: args.hiveUrl }, null, 2),
    "utf-8"
  );
}

describe("Hive OpenCode tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes portReachable in hive services output", async () => {
    const run = await createToolRun();

    const fetchSpy = mockFetch((url, init) => {
      expect(url).toContain(run.servicesUrl);
      expect(init?.signal).toBeDefined();

      return Promise.resolve(
        jsonResponse(servicesPayload({ portReachable: true }))
      );
    });

    const output = await executeTool(run, hiveServicesTool, {
      includeLogs: false,
      format: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Service: server");
    expect(output).toContain("Port reachable: yes");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("restarts all services via the Hive API", async () => {
    const run = await createToolRun();

    const fetchSpy = mockFetch((url, init) => {
      if (url === `${run.servicesUrl}/restart`) {
        expectMethod(init, "POST");
        return Promise.resolve(jsonResponse({ services: [] }));
      }

      if (url === run.servicesUrl) {
        expectMethod(init, "GET");
        return Promise.resolve(jsonResponse(servicesPayload()));
      }

      throwUnexpectedFetch(url, init);
    });

    const output = await executeTool(run, hiveRestartServicesTool, {
      confirm: true,
      includeLogs: false,
      format: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(RESTART_ALL_FETCH_CALLS);
    expect(output).toContain("Restarted all services.");
    expect(output).toContain("Service: server");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("restarts a single service via the Hive API", async () => {
    const run = await createToolRun();

    const fetchSpy = mockFetch((url, init) => {
      if (url === run.servicesUrl) {
        expectMethod(init, "GET");
        return Promise.resolve(jsonResponse(servicesPayload()));
      }

      if (url === `${run.servicesUrl}/service-1/restart`) {
        expectMethod(init, "POST");
        return Promise.resolve(
          jsonResponse({ id: "service-1", name: "server" })
        );
      }

      throwUnexpectedFetch(url, init);
    });

    const output = await executeTool(run, hiveRestartServiceTool, {
      confirm: true,
      serviceName: "server",
      includeLogs: false,
      format: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(RESTART_SINGLE_FETCH_CALLS);
    expect(output).toContain("Restarted service: server");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("reruns setup via the Hive API", async () => {
    const run = await createToolRun();

    const fetchSpy = mockFetch((url, init) => {
      expect(init?.signal).toBeDefined();

      if (url === `${run.hiveUrl}/api/cells/${run.cellId}/setup/retry`) {
        expectMethod(init, "POST");
        return Promise.resolve(
          jsonResponse({
            status: "ready",
            setupLogPath: "/tmp/setup.log",
            setupLog: "setup ok",
          })
        );
      }

      throwUnexpectedFetch(url, init);
    });

    const output = await executeTool(run, hiveRerunSetupTool, {
      confirm: true,
      format: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Setup rerun requested.");
    expect(output).toContain("setup ok");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });
});

async function createToolRun() {
  const worktreePath = await createTempWorktree();
  const cellId = "test-cell";
  const hiveUrl = "http://hive.local";

  await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

  return {
    worktreePath,
    cellId,
    hiveUrl,
    servicesUrl: `${hiveUrl}/api/cells/${cellId}/services`,
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: HTTP_OK,
    headers: { "content-type": "application/json" },
  });
}

function servicesPayload(overrides: Record<string, unknown> = {}) {
  return {
    services: [
      {
        id: "service-1",
        name: "server",
        type: "process",
        status: "running",
        port: TEST_SERVICE_PORT,
        command: "bun run dev",
        cwd: "/tmp",
        env: {},
        updatedAt: new Date().toISOString(),
        processAlive: true,
        ...overrides,
      },
    ],
  };
}

function mockFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => handler(resolveFetchUrl(input), init));
}

function expectMethod(init: RequestInit | undefined, method: string) {
  const actual = init?.method ?? "GET";
  if (actual !== method) {
    throw new Error(`Expected ${method} request, got ${actual}`);
  }
}

function throwUnexpectedFetch(
  url: string,
  init: RequestInit | undefined
): never {
  throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
}

async function executeTool(
  run: Awaited<ReturnType<typeof createToolRun>>,
  tool: { execute: (input: any, context: any) => Promise<string> },
  input: Record<string, unknown>
) {
  const controller = new AbortController();
  return await tool.execute(input, {
    sessionID: "session",
    messageID: "message",
    agent: "test",
    directory: run.worktreePath,
    worktree: run.worktreePath,
    abort: controller.signal,
    metadata() {
      // no-op for tests
    },
    ask: async () => {
      // no-op for tests
    },
  });
}
