import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveDevServerPort } from "../../apps/web/vite.config";
import { resolveDesktopDevConfiguration } from "./start-desktop-full";
import { createTempDirFixture } from "./test-temp-dir";

const createTempDir = createTempDirFixture("hive-desktop-dev-");
const TEST_PROCESS_ID = 1234;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;
const PORT_RESERVATION_ATTEMPTS = 50;
const MAX_PORT_NUMBER = 65_535;
const PROCESS_EXIT_TIMEOUT_MS = 5000;
const PROCESS_EXIT_POLL_INTERVAL_MS = 50;
const GRACEFUL_SHUTDOWN_DELAY_MS = 2000;
const DEV_SERVER_GATE_SETTLE_MS = 750;
const STANDARD_PORT_OVERRIDE = 41_999;
const DESKTOP_PORT_OVERRIDE = 42_001;

describe("desktop development launcher", () => {
  test("propagates the requested renderer port and isolated runtime settings", async () => {
    const fixture = await reserveConsecutivePorts(2);
    const backend = await reservePort();
    const backendPort = resolveServerPort(backend);
    await closeServer(backend);

    try {
      const hiveHome = join(createTempDir(), "hive-home");
      const configuration = await resolveDesktopDevConfiguration(
        process.cwd(),
        {
          ...process.env,
          HIVE_DESKTOP_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
          HIVE_DESKTOP_URL: `http://127.0.0.1:${fixture.basePort}`,
          HIVE_HOME: hiveHome,
        },
        TEST_PROCESS_ID
      );

      expect(configuration.desktopUrl).toBe(
        `http://127.0.0.1:${fixture.basePort}`
      );
      expect(configuration.env.HIVE_DESKTOP_DEV_PORT).toBe(
        String(fixture.basePort)
      );
      expect(configuration.env.WEB_PORT).toBe(String(fixture.basePort));
      expect(configuration.env.HIVE_DESKTOP_API_PORT).toBe(String(backendPort));
      expect(configuration.env.HIVE_HOME).toBe(hiveHome);
      expect(configuration.env.HIVE_WORKSPACE_ROOT).toBe(process.cwd());
      expect(configuration.readyFilePath).toBe(
        join(hiveHome, `desktop-dev-ready-${TEST_PROCESS_ID}.pid`)
      );
      expect(configuration.rendererReadyFilePath).toBe(
        join(hiveHome, `desktop-renderer-ready-${TEST_PROCESS_ID}.json`)
      );
    } finally {
      await closeServers(fixture.servers);
    }
  });

  test("preserves PORT for ordinary non-desktop Vite development", () => {
    expect(
      resolveDevServerPort({
        PORT: String(STANDARD_PORT_OVERRIDE),
        WEB_PORT: "42000",
      })
    ).toBe(STANDARD_PORT_OVERRIDE);
    expect(
      resolveDevServerPort({
        HIVE_DESKTOP_DEV_PORT: String(DESKTOP_PORT_OVERRIDE),
        PORT: String(STANDARD_PORT_OVERRIDE),
      })
    ).toBe(DESKTOP_PORT_OVERRIDE);
  });

  test("fails clearly instead of adopting an API on the configured port", async () => {
    const backend = await reservePort();
    const backendPort = resolveServerPort(backend);

    try {
      await expect(
        resolveDesktopDevConfiguration(process.cwd(), {
          ...process.env,
          HIVE_DESKTOP_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
          HIVE_HOME: join(createTempDir(), "hive-home"),
        })
      ).rejects.toThrow(`API port ${backendPort} is already in use`);
    } finally {
      await closeServer(backend);
    }
  });

  test(
    "waits for owned services and stops the full development process tree",
    async () => {
      const context = await spawnIntegrationLauncher({
        TEST_SHUTDOWN_DELAY_MS: String(GRACEFUL_SHUTDOWN_DELAY_MS),
      });
      let devPid: number | null = null;
      let rendererPid: number | null = null;

      try {
        const exitCode = await context.launcher.exited;
        const output = await context.stdout;
        const errorOutput = await context.stderr;
        devPid = Number(readFileSync(context.devPidPath, "utf8"));
        rendererPid = Number(readFileSync(context.rendererPidPath, "utf8"));
        const devState = JSON.parse(
          readFileSync(context.devStatePath, "utf8")
        ) as {
          hiveHome: string;
          workspaceRoot: string;
        };
        const rendererState = JSON.parse(
          readFileSync(context.rendererStatePath, "utf8")
        ) as { rendererPort: string };
        const desktopState = JSON.parse(
          readFileSync(context.desktopStatePath, "utf8")
        ) as {
          backendUrl: string;
          desktopUrl: string;
        };

        expect(exitCode).toBe(0);
        expect(errorOutput).toBe("");
        expect(output).toContain(
          `renderer ready at http://127.0.0.1:${context.fixture.basePort + 2}`
        );
        expect(devState).toEqual({
          hiveHome: context.hiveHome,
          workspaceRoot: process.cwd(),
        });
        expect(rendererState).toEqual({
          rendererPort: String(context.fixture.basePort + 2),
        });
        expect(desktopState).toEqual({
          backendUrl: `http://127.0.0.1:${context.backendPort}`,
          desktopUrl: `http://127.0.0.1:${context.fixture.basePort + 2}`,
        });
        expect(existsSync(context.gracefulExitPath)).toBe(true);
        expect(await waitForPidExit(devPid)).toBe(true);
        expect(await waitForPidExit(rendererPid)).toBe(true);
      } finally {
        await cleanupIntegrationLauncher(context, [devPid, rendererPid]);
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS
  );

  test(
    "stops detached development process trees when the terminal sends SIGHUP",
    async () => {
      if (process.platform === "win32") {
        return;
      }
      const outcome = await verifySignalShutdown({
        beforeDesktopStarts: async (context) => {
          await delay(DEV_SERVER_GATE_SETTLE_MS);
          expect(existsSync(context.desktopPidPath)).toBe(false);

          writeFileSync(context.apiGatePath, "ready");
          expect(await waitForFile(context.rendererPidPath)).toBe(true);
          await delay(DEV_SERVER_GATE_SETTLE_MS);
          expect(existsSync(context.desktopPidPath)).toBe(false);

          writeFileSync(context.rendererGatePath, "ready");
        },
        env: {
          TEST_OWNERSHIP_GATES: "1",
          TEST_SHUTDOWN_DELAY_MS: "0",
        },
        signals: ["SIGHUP"],
      });
      expect(outcome).toEqual({
        desktopExited: true,
        devExited: true,
        gracefulExit: true,
        rendererExited: true,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS
  );

  test(
    "forces resistant development processes after a second shutdown signal",
    async () => {
      if (process.platform === "win32") {
        return;
      }
      const outcome = await verifySignalShutdown({
        env: { TEST_SHUTDOWN_DELAY_MS: "60000" },
        signals: ["SIGHUP", "SIGTERM"],
      });
      expect(outcome).toEqual({
        desktopExited: true,
        devExited: true,
        gracefulExit: false,
        rendererExited: true,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS
  );
});

type IntegrationLauncherContext = Awaited<
  ReturnType<typeof spawnIntegrationLauncher>
>;

async function verifySignalShutdown(options: {
  beforeDesktopStarts?: (context: IntegrationLauncherContext) => Promise<void>;
  env: NodeJS.ProcessEnv;
  signals: NodeJS.Signals[];
}) {
  const context = await spawnIntegrationLauncher({
    TEST_DESKTOP_HOLD: "1",
    ...options.env,
  });
  let devPid: number | null = null;
  let rendererPid: number | null = null;
  let desktopPid: number | null = null;

  try {
    if (!(await waitForFile(context.devPidPath))) {
      throw new Error("Fake development process did not start");
    }
    await options.beforeDesktopStarts?.(context);
    if (!(await waitForFile(context.desktopPidPath))) {
      throw new Error("Fake desktop process did not start");
    }
    devPid = Number(readFileSync(context.devPidPath, "utf8"));
    rendererPid = Number(readFileSync(context.rendererPidPath, "utf8"));
    desktopPid = Number(readFileSync(context.desktopPidPath, "utf8"));

    for (const [index, signal] of options.signals.entries()) {
      context.launcher.kill(signal);
      if (index < options.signals.length - 1) {
        await delay(PROCESS_EXIT_POLL_INTERVAL_MS);
      }
    }
    await context.launcher.exited;
    await context.stdout;
    await context.stderr;

    return {
      desktopExited: await waitForPidExit(desktopPid),
      devExited: await waitForPidExit(devPid),
      gracefulExit: existsSync(context.gracefulExitPath),
      rendererExited: await waitForPidExit(rendererPid),
    };
  } finally {
    await cleanupIntegrationLauncher(context, [
      devPid,
      rendererPid,
      desktopPid,
    ]);
  }
}

async function spawnIntegrationLauncher(extraEnv: NodeJS.ProcessEnv) {
  const fixture = await reserveConsecutivePorts(2);
  const backend = await reservePort();
  const backendPort = resolveServerPort(backend);
  await closeServer(backend);
  const tempDir = createTempDir();
  const hiveHome = join(tempDir, "hive-home");
  const apiScriptPath = join(tempDir, "fake-api.ts");
  const rendererScriptPath = join(tempDir, "fake-renderer.ts");
  const desktopScriptPath = join(tempDir, "fake-desktop.ts");
  const devPidPath = join(tempDir, "dev.pid");
  const rendererPidPath = join(tempDir, "renderer.pid");
  const desktopPidPath = join(tempDir, "desktop.pid");
  const devStatePath = join(tempDir, "dev-state.json");
  const rendererStatePath = join(tempDir, "renderer-state.json");
  const desktopStatePath = join(tempDir, "desktop-state.json");
  const gracefulExitPath = join(tempDir, "graceful-exit");
  const rendererGatePath = join(tempDir, "renderer-gate");
  const apiGatePath = join(tempDir, "api-gate");

  if (extraEnv.TEST_OWNERSHIP_GATES !== "1") {
    writeFileSync(rendererGatePath, "ready");
    writeFileSync(apiGatePath, "ready");
  }

  writeFileSync(apiScriptPath, createFakeApiScript());
  writeFileSync(rendererScriptPath, createFakeRendererScript());
  writeFileSync(desktopScriptPath, createFakeDesktopScript());

  const launcher = Bun.spawn(
    [process.execPath, "scripts/dev/start-desktop-full.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HIVE_DESKTOP_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        HIVE_DESKTOP_FULL_API_COMMAND: `${process.execPath} ${JSON.stringify(apiScriptPath)}`,
        HIVE_DESKTOP_FULL_DESKTOP_COMMAND: `${process.execPath} ${JSON.stringify(desktopScriptPath)}`,
        HIVE_DESKTOP_FULL_RENDERER_COMMAND: `${process.execPath} ${JSON.stringify(rendererScriptPath)}`,
        HIVE_DESKTOP_URL: `http://127.0.0.1:${fixture.basePort}`,
        HIVE_HOME: hiveHome,
        TEST_DESKTOP_PID_PATH: desktopPidPath,
        TEST_DESKTOP_STATE_PATH: desktopStatePath,
        TEST_DEV_PID_PATH: devPidPath,
        TEST_DEV_STATE_PATH: devStatePath,
        TEST_GRACEFUL_EXIT_PATH: gracefulExitPath,
        TEST_RENDERER_PID_PATH: rendererPidPath,
        TEST_API_GATE_PATH: apiGatePath,
        TEST_RENDERER_GATE_PATH: rendererGatePath,
        TEST_RENDERER_STATE_PATH: rendererStatePath,
        ...extraEnv,
      },
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    }
  );

  return {
    apiGatePath,
    backendPort,
    desktopPidPath,
    desktopStatePath,
    devPidPath,
    devStatePath,
    fixture,
    gracefulExitPath,
    hiveHome,
    launcher,
    rendererGatePath,
    rendererPidPath,
    rendererStatePath,
    stderr: new Response(launcher.stderr).text(),
    stdout: new Response(launcher.stdout).text(),
  };
}

async function cleanupIntegrationLauncher(
  context: Awaited<ReturnType<typeof spawnIntegrationLauncher>>,
  pids: Array<number | null>
) {
  context.launcher.kill("SIGKILL");
  await context.launcher.exited;
  await closeServers(context.fixture.servers);
  for (const pid of pids) {
    if (pid && isPidAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }
}

function createFakeApiScript() {
  return `
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const backendUrl = new URL(process.env.HIVE_DESKTOP_BACKEND_URL);
const readyFilePath = process.env.HIVE_READY_FILE;
const api = Bun.serve({
  hostname: backendUrl.hostname,
  port: Number(backendUrl.port),
  fetch: (request) =>
    new URL(request.url).pathname === "/health"
      ? Response.json(
          { service: "hive", status: "ok" },
          { headers: { "X-Hive-Desktop-Ready": process.env.HIVE_DESKTOP_READY_TOKEN } }
        )
      : new Response("Not found", { status: 404 }),
});

mkdirSync(dirname(readyFilePath), { recursive: true });
const markApiReady = () => {
  if (existsSync(process.env.TEST_API_GATE_PATH)) {
    writeFileSync(readyFilePath, String(process.pid));
  }
};
markApiReady();
setInterval(markApiReady, 25);
writeFileSync(process.env.TEST_DEV_PID_PATH, String(process.pid));
writeFileSync(
  process.env.TEST_DEV_STATE_PATH,
  JSON.stringify({
    hiveHome: process.env.HIVE_HOME,
    workspaceRoot: process.env.HIVE_WORKSPACE_ROOT,
  })
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => {
    writeFileSync(process.env.TEST_GRACEFUL_EXIT_PATH, "ok");
    api.stop(true);
    process.exit(0);
  }, Number(process.env.TEST_SHUTDOWN_DELAY_MS ?? "0"));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => undefined, 10_000);
`;
}

function createFakeRendererScript() {
  return `
import { existsSync, writeFileSync } from "node:fs";

const rendererPort = Number(process.env.HIVE_DESKTOP_DEV_PORT) + 2;
const readyToken = process.env.HIVE_DESKTOP_READY_TOKEN;
const renderer = Bun.serve({
  hostname: process.env.HIVE_DESKTOP_DEV_HOST,
  port: rendererPort,
  fetch: () => new Response("Hive desktop dev", {
    headers: {
      "X-Hive-Desktop-Ready": existsSync(process.env.TEST_RENDERER_GATE_PATH)
        ? readyToken
        : "not-owned",
    },
  }),
});

writeFileSync(
  process.env.HIVE_DESKTOP_RENDERER_READY_FILE,
  JSON.stringify({ pid: process.pid, port: rendererPort, readyToken })
);
writeFileSync(process.env.TEST_RENDERER_PID_PATH, String(process.pid));
writeFileSync(
  process.env.TEST_RENDERER_STATE_PATH,
  JSON.stringify({ rendererPort: String(rendererPort) })
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => {
    writeFileSync(process.env.TEST_GRACEFUL_EXIT_PATH, "ok");
    renderer.stop(true);
    process.exit(0);
  }, Number(process.env.TEST_SHUTDOWN_DELAY_MS ?? "0"));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => undefined, 10_000);
`;
}

function createFakeDesktopScript() {
  return `
import { writeFileSync } from "node:fs";

writeFileSync(
  process.env.TEST_DESKTOP_STATE_PATH,
  JSON.stringify({
    backendUrl: process.env.HIVE_DESKTOP_BACKEND_URL,
    desktopUrl: process.env.HIVE_DESKTOP_URL,
  })
);
if (process.env.TEST_DESKTOP_HOLD === "1") {
  writeFileSync(process.env.TEST_DESKTOP_PID_PATH, String(process.pid));
  const stop = () => process.exit(0);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  setInterval(() => undefined, 10_000);
}
`;
}

async function reserveConsecutivePorts(count: number) {
  for (let attempt = 0; attempt < PORT_RESERVATION_ATTEMPTS; attempt += 1) {
    const first = await reservePort();
    const basePort = resolveServerPort(first);
    if (basePort + count > MAX_PORT_NUMBER) {
      await closeServer(first);
      continue;
    }

    const servers = [first];
    try {
      for (let offset = 1; offset < count; offset += 1) {
        servers.push(await reservePort(basePort + offset));
      }
      const probe = await reservePort(basePort + count);
      await closeServer(probe);
      return { basePort, servers };
    } catch {
      await closeServers(servers);
    }
  }

  throw new Error(`Unable to reserve ${count} consecutive test ports`);
}

function reservePort(port = 0): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function resolveServerPort(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port");
  }
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeServers(servers: Server[]) {
  await Promise.all(servers.map(closeServer));
}

async function waitForPidExit(pid: number) {
  const timeoutAt = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await delay(PROCESS_EXIT_POLL_INTERVAL_MS);
  }
  return !isPidAlive(pid);
}

async function waitForFile(path: string) {
  const timeoutAt = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    if (existsSync(path)) {
      return true;
    }
    await delay(PROCESS_EXIT_POLL_INTERVAL_MS);
  }
  return existsSync(path);
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
