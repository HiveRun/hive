import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("../../../..", import.meta.url).pathname;
const composeFile = join(repoRoot, "deploy", "docker", "docker-compose.yml");
const cliRoot = join(repoRoot, "packages", "cli");
const STARTUP_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1000;
const E2E_PORT_BASE = 35_000;
const E2E_PORT_SPAN = 1000;

const runId = `${process.pid}-${Date.now()}`;
const projectName = `hive-remote-e2e-${runId}`;

const run = async (
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {}
) => {
  const child = Bun.spawn({
    cmd: args,
    cwd: repoRoot,
    env: options.env ?? process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}`);
  }
};

const runCapture = async (
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) => {
  const child = Bun.spawn({
    cmd: args,
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Command failed: ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
  return stdout.trim();
};

const composeArgs = (args: string[]) => [
  "docker",
  "compose",
  "-p",
  projectName,
  "-f",
  composeFile,
  ...args,
];

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForHealth = async (url: string) => {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
};

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

async function main() {
  const hiveHome = await mkdtemp(join(tmpdir(), "hive-remote-e2e-home-"));
  const port = String(E2E_PORT_BASE + (process.pid % E2E_PORT_SPAN));
  const publicUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HIVE_INSTANCE_NAME: "Remote E2E Hive",
    HIVE_LOCAL_PORT: port,
    HIVE_OPENCODE_CONFIG_DIR: join(repoRoot, ".opencode"),
    HIVE_PUBLIC_API_URL: publicUrl,
    HIVE_PUBLIC_WEB_URL: publicUrl,
  };

  try {
    await run(composeArgs(["up", "-d", "--build"]), { env });
    await waitForHealth(`${publicUrl}/health`);

    const instanceResponse = await fetch(`${publicUrl}/api/instance`);
    assert(
      instanceResponse.ok,
      "instance metadata endpoint should be reachable"
    );
    const instance = (await instanceResponse.json()) as {
      apiBaseUrl?: string;
      capabilities?: { publicInternetSafe?: boolean };
      id?: string;
      mode?: string;
      name?: string;
      warnings?: string[];
    };
    assert(
      instance.name === "Remote E2E Hive",
      "instance name should match env"
    );
    assert(
      instance.mode === "private-remote",
      "instance should run in private-remote mode"
    );
    assert(
      instance.apiBaseUrl === publicUrl,
      "instance API URL should match public URL"
    );
    assert(
      instance.capabilities?.publicInternetSafe === false,
      "instance must not claim public internet safety"
    );
    assert(
      (instance.warnings ?? []).length > 0,
      "instance should expose private access warning"
    );
    const firstInstanceId = instance.id;

    const rootResponse = await fetch(publicUrl);
    assert(rootResponse.ok, "same-origin web UI should be reachable");
    assert(
      (await rootResponse.text()).includes('<div id="root"></div>'),
      "web UI should serve the built React shell"
    );

    const cliEnv = {
      ...process.env,
      HIVE_HOME: hiveHome,
    };
    await runCapture(
      ["bun", "src/index.ts", "instance", "add", "remote", publicUrl, "--use"],
      {
        cwd: cliRoot,
        env: cliEnv,
      }
    );
    const status = await runCapture(
      ["bun", "src/index.ts", "instance", "status"],
      {
        cwd: cliRoot,
        env: cliEnv,
      }
    );
    assert(
      status.includes("Remote E2E Hive"),
      "CLI status should read remote metadata"
    );

    await run(composeArgs(["restart", "hive"]), { env });
    await waitForHealth(`${publicUrl}/health`);
    const restarted = (await (
      await fetch(`${publicUrl}/api/instance`)
    ).json()) as {
      id?: string;
    };
    assert(
      restarted.id === firstInstanceId,
      "instance id should persist after container restart"
    );
  } finally {
    await run(composeArgs(["down", "-v", "--remove-orphans"]), { env }).catch(
      (error) => {
        process.stderr.write(
          `Failed to clean remote E2E compose stack: ${String(error)}\n`
        );
      }
    );
    await rm(hiveHome, { force: true, recursive: true });
  }
}

await main().catch((error) => {
  process.stderr.write(
    `Remote Compose E2E failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
