import { execFileSync } from "node:child_process";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Service } from "@opencode-ai/client/service";
import {
  type ManagedProcess,
  readProcessTable,
  runCommand,
  startManagedProcess,
  startProcessWithRetries,
} from "./process";
import type { RuntimeContext } from "./runtime-context";
import { waitForHttpOk } from "./wait";

type StartHiveServerOptions = {
  attempts: number;
  context: RuntimeContext;
  extraEnv: NodeJS.ProcessEnv;
  logsDir: string;
  readyPath: string;
  retryDelayMs: number;
  serverRoot: string;
  startupTimeoutMs: number;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
};

type StartE2eServerOptions = {
  context: RuntimeContext;
  logsDir: string;
  opencodeBinaryPath: string;
  serverRoot: string;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
};

type StartCompiledE2eServerOptions = Omit<
  StartE2eServerOptions,
  "serverRoot"
> & {
  executablePath: string;
  releaseDirectory: string;
};

type OpencodeServiceRegistration = {
  id?: unknown;
  password?: unknown;
  pid?: unknown;
  url?: unknown;
  version?: unknown;
};

const OPENCODE_SERVICE_COMMAND_PATTERN =
  /(?:^|[/\\])opencode2?(?:\.exe)?(?:\s|$)/;
const SERVE_ARGUMENT_PATTERN = /(?:^|\s)serve(?:\s|$)/;
const SERVICE_ARGUMENT_PATTERN = /(?:^|\s)--service(?:\s|$)/;
const NEXT_ENVIRONMENT_ENTRY_PATTERN = /^ [A-Za-z_][A-Za-z0-9_]*=/;

function isolatedOpencodeEnvironment(context: RuntimeContext) {
  const sharedXdgRoot = join(context.hiveHome, "xdg");
  const isolatedXdgRoot = join(context.runRoot, "opencode-xdg");
  return {
    XDG_CACHE_HOME: join(sharedXdgRoot, "cache"),
    XDG_CONFIG_HOME: join(isolatedXdgRoot, "config"),
    XDG_DATA_HOME: join(sharedXdgRoot, "data"),
    XDG_STATE_HOME: join(isolatedXdgRoot, "state"),
    OPENCODE_DB: join(context.runRoot, "opencode.db"),
    OPENCODE_CLIENT: "hive",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  };
}

const opencodeServiceRegistrationPath = (runRoot: string) =>
  join(runRoot, "opencode-xdg", "state", "opencode", "service.json");

async function readOpencodeServiceRegistration(
  file: string
): Promise<OpencodeServiceRegistration | null> {
  return await readFile(file, "utf8")
    .then((contents) => JSON.parse(contents) as OpencodeServiceRegistration)
    .catch(() => null);
}

async function restoreQuarantinedRegistration(
  quarantined: string,
  file: string
): Promise<void> {
  const contents = await readFile(quarantined);
  try {
    await writeFile(file, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  await rm(quarantined, { force: true });
}

async function recoverQuarantinedRegistrations(file: string): Promise<void> {
  const prefix = `${basename(file)}.hive-remove-`;
  const entries = await readdir(dirname(file)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      await restoreQuarantinedRegistration(join(dirname(file), entry), file);
    }
  }
}

async function removeRegistrationIf(
  file: string,
  shouldRemove: (registration: OpencodeServiceRegistration | null) => boolean
): Promise<boolean> {
  const quarantined = `${file}.hive-remove-${crypto.randomUUID()}`;
  try {
    await rename(file, quarantined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }

  const registration = await readOpencodeServiceRegistration(quarantined);
  if (shouldRemove(registration)) {
    await rm(quarantined, { force: true });
    return true;
  }

  await restoreQuarantinedRegistration(quarantined, file);
  return false;
}

function registeredProcessIsAlive(registration: OpencodeServiceRegistration) {
  if (
    typeof registration.pid !== "number" ||
    !Number.isInteger(registration.pid)
  ) {
    return false;
  }

  try {
    process.kill(registration.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readProcessEnvironment(pid: number): Promise<string | null> {
  if (process.platform === "linux") {
    return readFile(`/proc/${pid}/environ`, "utf8").catch(() => null);
  }

  try {
    return Promise.resolve(
      execFileSync("ps", ["eww", "-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      })
    );
  } catch {
    return Promise.resolve(null);
  }
}

function processEnvironmentHas(
  environment: string,
  key: string,
  value: string
): boolean {
  const expected = `${key}=${value}`;
  if (environment.includes("\0")) {
    return environment.split("\0").includes(expected);
  }
  const index = environment.indexOf(expected);
  if (index < 0 || (index > 0 && environment[index - 1] !== " ")) {
    return false;
  }
  const suffix = environment.slice(index + expected.length);
  return suffix.length === 0 || NEXT_ENVIRONMENT_ENTRY_PATTERN.test(suffix);
}

async function registeredProcessBelongsToRun(
  registration: OpencodeServiceRegistration,
  runRoot: string
): Promise<boolean> {
  if (
    typeof registration.pid !== "number" ||
    !Number.isInteger(registration.pid)
  ) {
    return false;
  }
  const args = readProcessTable().find(
    (entry) => entry.pid === registration.pid
  )?.args;
  if (
    !(
      args &&
      OPENCODE_SERVICE_COMMAND_PATTERN.test(args) &&
      SERVE_ARGUMENT_PATTERN.test(args) &&
      SERVICE_ARGUMENT_PATTERN.test(args)
    )
  ) {
    return false;
  }
  const environment = await readProcessEnvironment(registration.pid);
  return Boolean(
    environment &&
      processEnvironmentHas(
        environment,
        "OPENCODE_DB",
        join(runRoot, "opencode.db")
      ) &&
      processEnvironmentHas(
        environment,
        "XDG_STATE_HOME",
        join(runRoot, "opencode-xdg", "state")
      )
  );
}

function sameRegistration(
  left: OpencodeServiceRegistration,
  right: OpencodeServiceRegistration
): boolean {
  return (
    left.id === right.id &&
    left.pid === right.pid &&
    left.url === right.url &&
    left.version === right.version
  );
}

function runRootHasActiveRunner(runRoot: string): boolean {
  const pid = Number(basename(runRoot).split("-").at(-1));
  if (!Number.isInteger(pid)) {
    return false;
  }
  const args = readProcessTable().find((entry) => entry.pid === pid)?.args;
  return Boolean(
    args?.includes("src/runtime/e2e-runner.ts") ||
      args?.includes("src/runtime/desktop-e2e-runner.ts")
  );
}

async function stopRegisteredOpencodeService(
  file: string,
  runRoot: string
): Promise<"missing" | "preserved" | "stopped"> {
  await recoverQuarantinedRegistrations(file);
  const registration = await readOpencodeServiceRegistration(file);
  if (!registration) {
    return (await removeRegistrationIf(file, (candidate) => !candidate))
      ? "missing"
      : "preserved";
  }
  if (!registeredProcessIsAlive(registration)) {
    return (await removeRegistrationIf(file, (candidate) =>
      Boolean(
        candidate &&
          sameRegistration(registration, candidate) &&
          !registeredProcessIsAlive(candidate)
      )
    ))
      ? "missing"
      : "preserved";
  }
  if (!(await registeredProcessBelongsToRun(registration, runRoot))) {
    return "preserved";
  }
  const latest = await readOpencodeServiceRegistration(file);
  if (
    !(
      latest &&
      sameRegistration(registration, latest) &&
      (await registeredProcessBelongsToRun(latest, runRoot))
    )
  ) {
    return "preserved";
  }
  const validatedRegistrationFile = `${file}.hive-stop-${crypto.randomUUID()}`;
  await writeFile(validatedRegistrationFile, JSON.stringify(latest), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await Service.stop({ file: validatedRegistrationFile, pty: "clear" });
  } finally {
    await rm(validatedRegistrationFile, { force: true });
  }
  await removeRegistrationIf(file, (candidate) =>
    Boolean(
      candidate &&
        sameRegistration(candidate, latest) &&
        !registeredProcessIsAlive(candidate)
    )
  );
  return "stopped";
}

async function configureIsolatedOpencodeService(options: {
  binaryPath: string;
  context: RuntimeContext;
  cwd: string;
}): Promise<void> {
  await runCommand(
    options.binaryPath,
    ["service", "set", "port", String(options.context.opencodePort)],
    {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...isolatedOpencodeEnvironment(options.context),
      },
      label: "Configure isolated OpenCode service port",
      timeoutMs: 120_000,
    }
  );
}

export async function stopIsolatedOpencodeService(
  context: RuntimeContext
): Promise<void> {
  const result = await stopRegisteredOpencodeService(
    opencodeServiceRegistrationPath(context.runRoot),
    context.runRoot
  );
  if (result === "preserved") {
    throw new Error(
      `Refusing to stop an OpenCode PID that is not owned by ${context.runRoot}`
    );
  }
}

export async function cleanupRegisteredOpencodeServices(options: {
  preserveRunRoot: string;
  runsRoot: string;
}): Promise<number> {
  const entries = await readdir(options.runsRoot, {
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  let stopped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runRoot = join(options.runsRoot, entry.name);
    if (
      runRoot === options.preserveRunRoot ||
      runRootHasActiveRunner(runRoot)
    ) {
      continue;
    }
    const file = opencodeServiceRegistrationPath(runRoot);
    const result = await stopRegisteredOpencodeService(file, runRoot);
    stopped += Number(result === "stopped");
  }

  return stopped;
}

export async function startHiveServerWithRetries(
  options: StartHiveServerOptions
): Promise<ManagedProcess> {
  return await startProcessWithRetries({
    attempts: options.attempts,
    retryDelayMs: options.retryDelayMs,
    startProcess: () =>
      startManagedProcess({
        command: "bun",
        args: ["run", "src/index.ts"],
        cwd: options.serverRoot,
        env: {
          ...process.env,
          DATABASE_URL: `file:${options.context.dbPath}`,
          HIVE_HOME: options.context.hiveHome,
          HIVE_WORKSPACE_ROOT: options.context.workspaceRoot,
          HIVE_BROWSE_ROOT: options.context.runRoot,
          HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
          HOST: "127.0.0.1",
          PORT: String(options.context.apiPort),
          ...options.extraEnv,
          ...isolatedOpencodeEnvironment(options.context),
        },
        logsDir: options.logsDir,
        name: "server",
      }),
    stopProcess: options.stopProcess,
    waitUntilReady: async () => {
      await waitForHttpOk(`${options.context.apiUrl}${options.readyPath}`, {
        timeoutMs: options.startupTimeoutMs,
      });
    },
  });
}

export async function startDefaultHiveServer(options: {
  context: RuntimeContext;
  extraEnv: NodeJS.ProcessEnv;
  logsDir: string;
  readyPath: string;
  serverRoot: string;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
}): Promise<ManagedProcess> {
  return await startHiveServerWithRetries({
    attempts: 3,
    context: options.context,
    extraEnv: options.extraEnv,
    logsDir: options.logsDir,
    readyPath: options.readyPath,
    retryDelayMs: 1000,
    serverRoot: options.serverRoot,
    startupTimeoutMs: 180_000,
    stopProcess: options.stopProcess,
  });
}

export function startWebE2eServer(
  options: StartE2eServerOptions
): Promise<ManagedProcess> {
  return startE2eServer(options, {
    WEB_PORT: String(options.context.webPort),
    CORS_ORIGIN: options.context.webUrl,
  });
}

export function startDesktopE2eServer(
  options: StartE2eServerOptions
): Promise<ManagedProcess> {
  return startE2eServer(options, { CORS_ORIGIN: "null" });
}

export async function startCompiledWebE2eServer(
  options: StartCompiledE2eServerOptions
): Promise<ManagedProcess> {
  await configureIsolatedOpencodeService({
    binaryPath: options.opencodeBinaryPath,
    context: options.context,
    cwd: options.releaseDirectory,
  });
  return await startProcessWithRetries({
    attempts: 2,
    retryDelayMs: 1000,
    startProcess: () =>
      startManagedProcess({
        command: options.executablePath,
        args: ["--foreground"],
        cwd: options.releaseDirectory,
        env: {
          ...process.env,
          CORS_ORIGIN: options.context.apiUrl,
          DATABASE_URL: `file:${options.context.dbPath}`,
          HIVE_BROWSE_ROOT: options.context.runRoot,
          HIVE_FOREGROUND: "1",
          HIVE_HOME: options.context.hiveHome,
          HIVE_LOG_DIR: options.logsDir,
          HIVE_MIGRATIONS_DIR: join(options.releaseDirectory, "migrations"),
          HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
          ...isolatedOpencodeEnvironment(options.context),
          HIVE_WORKSPACE_ROOT: options.context.workspaceRoot,
          HOST: "127.0.0.1",
          PORT: String(options.context.apiPort),
          WEB_PORT: String(options.context.apiPort),
        },
        logsDir: options.logsDir,
        name: "compiled-server",
      }),
    stopProcess: options.stopProcess,
    waitUntilReady: async () => {
      await waitForHttpOk(`${options.context.apiUrl}/health`, {
        timeoutMs: 180_000,
      });
    },
  });
}

async function startE2eServer(
  options: StartE2eServerOptions,
  extraEnv: NodeJS.ProcessEnv
): Promise<ManagedProcess> {
  await configureIsolatedOpencodeService({
    binaryPath: options.opencodeBinaryPath,
    context: options.context,
    cwd: options.serverRoot,
  });
  return await startDefaultHiveServer({
    context: options.context,
    extraEnv,
    logsDir: options.logsDir,
    readyPath: "/health",
    serverRoot: options.serverRoot,
    stopProcess: options.stopProcess,
  });
}
