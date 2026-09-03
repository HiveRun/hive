import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import hivePlugin, {
  HIVE_PLUGIN_CAPABILITIES,
  HIVE_PLUGIN_ID,
  HIVE_PLUGIN_REVISION,
} from "../../agents/tools/hive";

const TEST_SERVICE_PORT = 39_993;
const HTTP_OK = 200;
const RESTART_ALL_FETCH_CALLS = 2;
const RESTART_SINGLE_FETCH_CALLS = 3;
const ORIGINAL_HIVE_CELL_ID = process.env.HIVE_CELL_ID;
const ORIGINAL_HIVE_CELL_RUNTIME_DIR = process.env.HIVE_CELL_RUNTIME_DIR;
const ORIGINAL_HIVE_HOME = process.env.HIVE_HOME;
const HIVE_TOOL_NAMES = [
  "hive_services",
  "hive_service_logs",
  "hive_setup_logs",
  "hive_restart_services",
  "hive_restart_service",
  "hive_rerun_setup",
] as const;

type RegisteredTool = {
  name: string;
  input: Record<string, unknown>;
  execute: (
    input: unknown,
    context: unknown
  ) => Promise<{ content?: string; metadata?: Record<string, unknown> }>;
};

type SessionContextHook = (event: {
  tools: Record<string, unknown>;
  system: Record<string, unknown>[];
}) => Promise<void> | void;

type ShellCreateHook = (event: {
  cwd: string;
  env: Record<string, string | undefined>;
}) => Promise<void> | void;

type PermissionHook = (event: {
  action: string;
  resources: readonly string[];
  effect: "allow" | "ask" | "deny";
  message?: string;
}) => Promise<void> | void;

type PluginHarness = {
  tools: Map<string, RegisteredTool>;
  sessionContext?: SessionContextHook;
  shellCreate?: ShellCreateHook;
  permission?: PermissionHook;
};

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

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
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
    restoreEnvironment("HIVE_CELL_ID", ORIGINAL_HIVE_CELL_ID);
    restoreEnvironment("HIVE_CELL_RUNTIME_DIR", ORIGINAL_HIVE_CELL_RUNTIME_DIR);
    restoreEnvironment("HIVE_HOME", ORIGINAL_HIVE_HOME);
  });

  it("registers the v2 capabilities and all Hive tool names", async () => {
    const run = await createToolRun();

    expect(hivePlugin.id).toBe(HIVE_PLUGIN_ID);
    expect(HIVE_PLUGIN_REVISION).toBe("1");
    expect(HIVE_PLUGIN_CAPABILITIES).toEqual([
      "tools",
      "fresh-context",
      "shell-environment",
      "worktree-boundary",
    ]);
    expect([...run.plugin.tools.keys()]).toEqual(HIVE_TOOL_NAMES);
    expect(run.plugin.sessionContext).toBeTypeOf("function");
    expect(run.plugin.shellCreate).toBeTypeOf("function");
    expect(run.plugin.permission).toBeTypeOf("function");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("uses the project worktree when OpenCode starts in a subdirectory", async () => {
    const worktreePath = await createTempWorktree();
    const activeDirectory = join(worktreePath, "packages", "app");
    await fs.mkdir(activeDirectory, { recursive: true });
    await writeHiveToolConfig({
      worktreePath,
      cellId: "test-cell",
      hiveUrl: "http://hive.local",
    });

    const plugin = await createPluginHarness(worktreePath, activeDirectory);

    expect([...plugin.tools.keys()]).toEqual(HIVE_TOOL_NAMES);
    await fs.rm(worktreePath, { recursive: true, force: true });
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

    const output = await executeTool(run, "hive_services", {
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

    const output = await executeTool(run, "hive_restart_services", {
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

    const output = await executeTool(run, "hive_restart_service", {
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

    const output = await executeTool(run, "hive_rerun_setup", {
      confirm: true,
      format: "text",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Setup rerun requested.");
    expect(output).toContain("setup ok");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("refreshes and validates cell health before model context", async () => {
    const run = await createToolRun();
    mockHealthFetch(run, servicesPayload(), (init) => {
      expect(init?.signal).toBeDefined();
    });
    const event = {
      tools: Object.fromEntries(HIVE_TOOL_NAMES.map((name) => [name, {}])),
      system: [] as Record<string, unknown>[],
    };

    await run.plugin.sessionContext?.(event);

    expect(event.system).toHaveLength(1);
    expect(event.system[0]?.text).toContain("# Fresh Hive Cell Context");
    expect(event.system[0]?.text).toContain(`Cell: Test (${run.cellId})`);
    expect(event.system[0]?.metadata).toMatchObject({
      hive: {
        pluginId: HIVE_PLUGIN_ID,
        pluginRevision: HIVE_PLUGIN_REVISION,
        ready: true,
      },
    });

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("injects fresh cell and named-port environment into shells", async () => {
    const run = await createToolRun();
    process.env.HIVE_CELL_ID = run.cellId;
    process.env.HIVE_HOME = "/shared-hive-home";
    mockHealthFetch(
      run,
      servicesPayload({
        env: {
          HIVE_CELL_RUNTIME_DIR: "/runtime/test-cell",
          HIVE_CLI_BIN: "/opt/hive/bin/hive",
        },
        ports: [
          {
            name: "http",
            port: TEST_SERVICE_PORT,
            primary: true,
            protocol: "http",
            portReachable: true,
          },
        ],
      })
    );
    const event = { cwd: run.worktreePath, env: {} };

    await run.plugin.shellCreate?.(event);

    expect(event.env).toMatchObject({
      HIVE_CELL_ID: run.cellId,
      HIVE_BROWSE_ROOT: run.worktreePath,
      HIVE_HOME: join(run.worktreePath, ".hive", "home"),
      HIVE_CLI_BIN: "/opt/hive/bin/hive",
      HIVE_CELL_RUNTIME_DIR: "/runtime/test-cell",
      SERVER_HTTP_PORT: String(TEST_SERVICE_PORT),
      SERVER_PORT: String(TEST_SERVICE_PORT),
    });

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("denies mutations outside the cell worktree", async () => {
    const run = await createToolRun();
    const event = {
      action: "edit",
      resources: [join(run.worktreePath, "..", "other", "file.ts")],
      effect: "allow" as const,
      message: undefined as string | undefined,
    };

    await run.plugin.permission?.(event);

    expect(event.effect).toBe("deny");
    expect(event.message).toContain("outside the cell worktree");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
  });

  it("denies shell and mutation paths that escape through symlinks", async () => {
    const run = await createToolRun();
    const outsidePath = await createTempWorktree();
    const linkPath = join(run.worktreePath, "outside-link");
    await fs.symlink(outsidePath, linkPath, "dir");
    const shellEvent = { cwd: linkPath, env: {} };
    const permissionEvent = {
      action: "edit",
      resources: [join(linkPath, "new-file.ts")],
      effect: "allow" as const,
      message: undefined as string | undefined,
    };

    await expect(run.plugin.shellCreate?.(shellEvent)).rejects.toThrow(
      "outside the cell worktree"
    );
    await run.plugin.permission?.(permissionEvent);

    expect(permissionEvent.effect).toBe("deny");
    expect(permissionEvent.message).toContain("outside the cell worktree");

    await fs.rm(run.worktreePath, { recursive: true, force: true });
    await fs.rm(outsidePath, { recursive: true, force: true });
  });
});

async function createToolRun() {
  const worktreePath = await createTempWorktree();
  const cellId = "test-cell";
  const hiveUrl = "http://hive.local";

  await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });
  const plugin = await createPluginHarness(worktreePath);

  return {
    worktreePath,
    cellId,
    hiveUrl,
    servicesUrl: `${hiveUrl}/api/cells/${cellId}/services`,
    plugin,
  };
}

async function createPluginHarness(
  worktreePath: string,
  activeDirectory = worktreePath
): Promise<PluginHarness> {
  const harness: PluginHarness = { tools: new Map() };
  const registration = () => ({ dispose: () => Promise.resolve() });
  const context = {
    location: {
      directory: activeDirectory,
      project: {
        id: "project",
        directory: worktreePath,
        canonical: worktreePath,
      },
    },
    tool: {
      transform: (
        callback: (draft: { add: (tool: RegisteredTool) => void }) => void
      ) => {
        callback({
          add: (tool) => {
            harness.tools.set(tool.name, tool);
          },
        });
        return Promise.resolve(registration());
      },
    },
    session: {
      hook: (name: string, callback: SessionContextHook) => {
        if (name === "context") {
          harness.sessionContext = callback;
        }
        return Promise.resolve(registration());
      },
    },
    shell: {
      hook: (name: string, callback: ShellCreateHook) => {
        if (name === "create.before") {
          harness.shellCreate = callback;
        }
        return Promise.resolve(registration());
      },
    },
    permission: {
      hook: (name: string, callback: PermissionHook) => {
        if (name === "evaluate") {
          harness.permission = callback;
        }
        return Promise.resolve(registration());
      },
    },
    reference: {
      list: () => Promise.resolve({ data: [] }),
    },
  };
  await hivePlugin.setup(context as never);
  return harness;
}

function cellPayload(run: Awaited<ReturnType<typeof createToolRun>>) {
  return {
    id: run.cellId,
    name: "Test",
    status: "ready",
    workspacePath: run.worktreePath,
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

function mockHealthFetch(
  run: Awaited<ReturnType<typeof createToolRun>>,
  servicePayload: ReturnType<typeof servicesPayload>,
  inspectRequest?: (init: RequestInit | undefined) => void
) {
  return mockFetch((url, init) => {
    inspectRequest?.(init);
    if (
      url === `${run.hiveUrl}/api/cells/${run.cellId}?includeSetupLog=false`
    ) {
      return Promise.resolve(jsonResponse(cellPayload(run)));
    }
    if (url === `${run.servicesUrl}?logLines=1`) {
      return Promise.resolve(jsonResponse(servicePayload));
    }
    throwUnexpectedFetch(url, init);
  });
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
  toolName: string,
  input: Record<string, unknown>
) {
  const tool = run.plugin.tools.get(toolName);
  if (!tool) {
    throw new Error(`Tool not registered: ${toolName}`);
  }
  const result = await tool.execute(input, {
    sessionID: "session",
    messageID: "message",
    agent: "test",
  });
  return result.content ?? "";
}
