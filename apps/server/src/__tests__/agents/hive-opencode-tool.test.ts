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
    const worktreePath = await createTempWorktree();
    const cellId = "test-cell";
    const hiveUrl = "http://hive.local";

    await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = resolveFetchUrl(input);

        expect(url).toContain(`${hiveUrl}/api/cells/${cellId}/services`);
        expect(init?.signal).toBeDefined();

        const payload = {
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
              portReachable: true,
            },
          ],
        };

        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: HTTP_OK,
            headers: { "content-type": "application/json" },
          })
        );
      });

    const controller = new AbortController();
    const output = await hiveServicesTool.execute(
      { includeLogs: false, format: "text" },
      {
        sessionID: "session",
        messageID: "message",
        agent: "test",
        directory: worktreePath,
        worktree: worktreePath,
        abort: controller.signal,
        metadata() {
          // no-op for tests
        },
        ask: async () => {
          // no-op for tests
        },
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Service: server");
    expect(output).toContain("Port reachable: yes");

    await fs.rm(worktreePath, { recursive: true, force: true });
  });

  it("restarts all services via the Hive API", async () => {
    const worktreePath = await createTempWorktree();
    const cellId = "test-cell";
    const hiveUrl = "http://hive.local";

    await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = resolveFetchUrl(input);

        const method = init?.method ?? "GET";

        if (url === `${hiveUrl}/api/cells/${cellId}/services/restart`) {
          expect(method).toBe("POST");
          return Promise.resolve(
            new Response(JSON.stringify({ services: [] }), {
              status: HTTP_OK,
              headers: { "content-type": "application/json" },
            })
          );
        }

        if (url === `${hiveUrl}/api/cells/${cellId}/services`) {
          expect(method).toBe("GET");
          const payload = {
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
              },
            ],
          };
          return Promise.resolve(
            new Response(JSON.stringify(payload), {
              status: HTTP_OK,
              headers: { "content-type": "application/json" },
            })
          );
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      });

    const controller = new AbortController();
    const output = await hiveRestartServicesTool.execute(
      { confirm: true, includeLogs: false, format: "text" },
      {
        sessionID: "session",
        messageID: "message",
        agent: "test",
        directory: worktreePath,
        worktree: worktreePath,
        abort: controller.signal,
        metadata() {
          // no-op for tests
        },
        ask: async () => {
          // no-op for tests
        },
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(RESTART_ALL_FETCH_CALLS);
    expect(output).toContain("Restarted all services.");
    expect(output).toContain("Service: server");

    await fs.rm(worktreePath, { recursive: true, force: true });
  });

  it("restarts a single service via the Hive API", async () => {
    const worktreePath = await createTempWorktree();
    const cellId = "test-cell";
    const hiveUrl = "http://hive.local";

    await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = resolveFetchUrl(input);

        const method = init?.method ?? "GET";

        if (url === `${hiveUrl}/api/cells/${cellId}/services`) {
          expect(method).toBe("GET");
          const payload = {
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
              },
            ],
          };
          return Promise.resolve(
            new Response(JSON.stringify(payload), {
              status: HTTP_OK,
              headers: { "content-type": "application/json" },
            })
          );
        }

        if (
          url === `${hiveUrl}/api/cells/${cellId}/services/service-1/restart`
        ) {
          expect(method).toBe("POST");
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "service-1",
                name: "server",
              }),
              {
                status: HTTP_OK,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      });

    const controller = new AbortController();
    const output = await hiveRestartServiceTool.execute(
      {
        confirm: true,
        serviceName: "server",
        includeLogs: false,
        format: "text",
      },
      {
        sessionID: "session",
        messageID: "message",
        agent: "test",
        directory: worktreePath,
        worktree: worktreePath,
        abort: controller.signal,
        metadata() {
          // no-op for tests
        },
        ask: async () => {
          // no-op for tests
        },
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(RESTART_SINGLE_FETCH_CALLS);
    expect(output).toContain("Restarted service: server");

    await fs.rm(worktreePath, { recursive: true, force: true });
  });

  it("reruns setup via the Hive API", async () => {
    const worktreePath = await createTempWorktree();
    const cellId = "test-cell";
    const hiveUrl = "http://hive.local";

    await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = resolveFetchUrl(input);

        const method = init?.method ?? "GET";
        expect(init?.signal).toBeDefined();

        if (url === `${hiveUrl}/api/cells/${cellId}/setup/retry`) {
          expect(method).toBe("POST");
          const payload = {
            status: "ready",
            setupLogPath: "/tmp/setup.log",
            setupLog: "setup ok",
          };
          return Promise.resolve(
            new Response(JSON.stringify(payload), {
              status: HTTP_OK,
              headers: { "content-type": "application/json" },
            })
          );
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      });

    const controller = new AbortController();
    const output = await hiveRerunSetupTool.execute(
      { confirm: true, format: "text" },
      {
        sessionID: "session",
        messageID: "message",
        agent: "test",
        directory: worktreePath,
        worktree: worktreePath,
        abort: controller.signal,
        metadata() {
          // no-op for tests
        },
        ask: async () => {
          // no-op for tests
        },
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Setup rerun requested.");
    expect(output).toContain("setup ok");

    await fs.rm(worktreePath, { recursive: true, force: true });
  });
});
