import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type WaitForServerReadyConfig = {
  url: string;
  timeoutMs?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  isReadyResponse?: (response: Response) => Promise<boolean>;
  readyFilePath?: string;
  readyFileContents?: string;
  readyLogFilePath?: string;
  readyLogInitialOffset?: number;
  readyLogPattern?: RegExp;
};

type RunCommandResult = {
  status: number | null;
  stdout: string;
};

type FindListeningProcessIdOptions = {
  port: number;
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => RunCommandResult;
};

export type RunningDaemon =
  | {
      managed: true;
      pid: number;
    }
  | {
      managed: false;
      pid: number | null;
    };

export type DaemonStartupPhase =
  | "detecting-daemon"
  | "starting-daemon"
  | "waiting-for-api"
  | "api-ready"
  | "error";

export type DaemonStartupEvent = {
  phase: DaemonStartupPhase;
  message: string;
  healthcheckUrl: string;
  pid?: number | null;
  error?: string;
  timestamp: number;
};

export type DaemonRuntimeConfig = {
  executablePath: string;
  foregroundArgs?: string[];
  detachedCwd: string;
  env?: NodeJS.ProcessEnv;
  envStripKeys?: readonly string[];
  healthcheckUrl: string;
  hiveHome: string;
  logFilePath: string;
  pidFilePath: string;
  readyFilePath: string;
  startLockFilePath: string;
  useShellDetach?: boolean;
  workspaceRoot: string;
  onStatus?: (event: DaemonStartupEvent) => void;
};

type LaunchResult = {
  pid: number | null;
  logFile: string;
  logOffset: number;
  readyFileContents?: string;
};

export type DaemonLaunchResult = LaunchResult;

const ADDRESS_PORT_PATTERN = /:(\d+)$/;
const LINE_SPLIT_PATTERN = /\r?\n/;
const COLUMN_SPLIT_PATTERN = /\s+/;
const SS_PID_PATTERN = /pid=(\d+)/;
const NETSTAT_MIN_COLUMNS = 5;
const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;
const DEFAULT_SERVER_READY_TIMEOUT_MS = 180_000;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];
const OPEN_BRACKET_PREFIX_PATTERN = /^\[/;
const CLOSE_BRACKET_SUFFIX_PATTERN = /\]$/;
export const DAEMON_PROBE_TIMEOUT_MS = 800;
export const MANAGED_DAEMON_VERIFY_TIMEOUT_MS = 5000;
export const MANAGED_DAEMON_VERIFY_INTERVAL_MS = 200;
export const DETACHED_DAEMON_READY_TIMEOUT_MS = 180_000;
export const DETACHED_DAEMON_READY_INTERVAL_MS = 500;
export const DETACHED_READY_FILE_PREWAIT_TIMEOUT_MS = 5000;
export const DAEMON_READY_LOG_PATTERN = /API listening on /;

const sleep = (ms: number) =>
  new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });

const defaultRunCommand = (
  command: string,
  args: string[]
): RunCommandResult => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
  };
};

const parsePositiveInteger = (value: string) => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parsePortFromAddress = (value: string) => {
  const match = value.match(ADDRESS_PORT_PATTERN);
  const portText = match?.[1];
  return portText ? Number.parseInt(portText, 10) : null;
};

const firstParsedPid = (values: Iterable<string>) => {
  for (const value of values) {
    const pid = parsePositiveInteger(value);
    if (pid) {
      return pid;
    }
  }

  return null;
};

const findUnixListeningProcessId = (
  port: number,
  runCommand: (command: string, args: string[]) => RunCommandResult
) => {
  const lsofResult = runCommand("lsof", [
    "-n",
    "-P",
    "-t",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
  ]);

  if (lsofResult.status === 0) {
    const [firstPid] = lsofResult.stdout
      .split(LINE_SPLIT_PATTERN)
      .map((line) => line.trim())
      .filter(Boolean);

    return firstPid ? parsePositiveInteger(firstPid) : null;
  }

  const ssResult = runCommand("ss", ["-ltnp", `sport = :${port}`]);
  if (ssResult.status !== 0) {
    return null;
  }

  return firstParsedPid(
    ssResult.stdout
      .split(LINE_SPLIT_PATTERN)
      .map((line) => line.match(SS_PID_PATTERN)?.[1] ?? "")
  );
};

const findWindowsListeningProcessId = (
  port: number,
  runCommand: (command: string, args: string[]) => RunCommandResult
) => {
  const result = runCommand("netstat", ["-ano", "-p", "tcp"]);

  if (result.status !== 0) {
    return null;
  }

  for (const line of result.stdout.split(LINE_SPLIT_PATTERN)) {
    const columns = line.trim().split(COLUMN_SPLIT_PATTERN);
    if (columns.length < NETSTAT_MIN_COLUMNS) {
      continue;
    }

    const protocol = columns[0];
    const localAddress = columns[1];
    const state = columns[3];
    const pidText = columns[4];
    if (!(protocol && localAddress && state && pidText)) {
      continue;
    }

    if (
      protocol.toUpperCase() !== "TCP" ||
      state.toUpperCase() !== "LISTENING"
    ) {
      continue;
    }

    if (parsePortFromAddress(localAddress) !== port) {
      continue;
    }

    const pid = firstParsedPid([pidText]);
    if (pid) {
      return pid;
    }
  }

  return null;
};

export const isHiveHealthResponse = (value: unknown) =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as { status?: unknown; service?: unknown }).status === "ok" &&
      (value as { service?: unknown }).service === "hive"
  );

export const extractPortFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number.parseInt(parsed.port, 10);
    }

    return parsed.protocol === "https:"
      ? HTTPS_DEFAULT_PORT
      : HTTP_DEFAULT_PORT;
  } catch {
    return null;
  }
};

const normalizeHostname = (hostname: string) =>
  hostname
    .replace(OPEN_BRACKET_PREFIX_PATTERN, "")
    .replace(CLOSE_BRACKET_SUFFIX_PATTERN, "")
    .toLowerCase();

const waitForReadySignal = (args: {
  readyFilePath?: string;
  readyFileContents?: string;
  readyLogFilePath?: string;
  readyLogInitialOffset?: number;
  readyLogPattern?: RegExp;
}) =>
  readinessFileIndicatesReady(args.readyFilePath, args.readyFileContents) ||
  readinessLogIndicatesReady(
    args.readyLogFilePath,
    args.readyLogInitialOffset,
    args.readyLogPattern
  );

const probeCandidateUrl = async (args: {
  candidateUrl: string;
  requestTimeoutMs: number;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  isReadyResponse?: (response: Response) => Promise<boolean>;
}) => {
  let response: Response | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs);

  try {
    response = await args.fetchImpl(args.candidateUrl, {
      method: "GET",
      signal: controller.signal,
    });
  } catch {
    response = null;
  } finally {
    clearTimeout(timeout);
  }

  if (
    response &&
    (await responseIndicatesReady(response, args.isReadyResponse))
  ) {
    return true;
  }

  if (response?.body) {
    await response.body.cancel().catch(() => null);
  }

  return false;
};

const expandLoopbackProbeUrls = (url: string) => {
  try {
    const parsed = new URL(url);
    const normalizedHostname = normalizeHostname(parsed.hostname);
    if (!LOOPBACK_HOSTNAMES.includes(normalizedHostname)) {
      return [url];
    }

    const candidates = [url];
    for (const hostname of LOOPBACK_HOSTNAMES) {
      if (hostname === normalizedHostname) {
        continue;
      }

      const candidate = new URL(url);
      candidate.host = hostname.includes(":")
        ? `[${hostname}]${candidate.port ? `:${candidate.port}` : ""}`
        : `${hostname}${candidate.port ? `:${candidate.port}` : ""}`;
      candidates.push(candidate.toString());
    }

    return candidates;
  } catch {
    return [url];
  }
};

export const findListeningProcessId = ({
  port,
  platform = process.platform,
  runCommand = defaultRunCommand,
}: FindListeningProcessIdOptions) => {
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  if (platform === "win32") {
    return findWindowsListeningProcessId(port, runCommand);
  }

  return findUnixListeningProcessId(port, runCommand);
};

export const findHealthcheckProcessId = (healthcheckUrl: string) => {
  const port = extractPortFromUrl(healthcheckUrl);
  return port ? findListeningProcessId({ port }) : null;
};

const responseIndicatesReady = async (
  candidateResponse: Response,
  isReadyResponse?: (response: Response) => Promise<boolean>
) => {
  if (!candidateResponse.ok) {
    return false;
  }

  if (!isReadyResponse) {
    return true;
  }

  return await isReadyResponse(candidateResponse);
};

const readinessLogIndicatesReady = (
  readyLogFilePath?: string,
  readyLogInitialOffset = 0,
  readyLogPattern?: RegExp
) => {
  if (!(readyLogFilePath && readyLogPattern && existsSync(readyLogFilePath))) {
    return false;
  }

  try {
    const stats = statSync(readyLogFilePath);
    if (stats.size <= readyLogInitialOffset) {
      return false;
    }

    const length = stats.size - readyLogInitialOffset;
    const buffer = Buffer.alloc(length);
    const fd = openSync(readyLogFilePath, "r");

    try {
      readSync(fd, buffer, 0, length, readyLogInitialOffset);
    } finally {
      closeSync(fd);
    }

    return readyLogPattern.test(buffer.toString("utf8"));
  } catch {
    return false;
  }
};

const readinessFileIndicatesReady = (
  readyFilePath?: string,
  readyFileContents?: string
) => {
  if (!(readyFilePath && existsSync(readyFilePath))) {
    return false;
  }

  try {
    const contents = readFileSync(readyFilePath, "utf8").trim();
    if (!readyFileContents) {
      return contents.length > 0;
    }

    return contents === readyFileContents;
  } catch {
    return false;
  }
};

export const waitForServerReady = async ({
  url,
  timeoutMs = DEFAULT_SERVER_READY_TIMEOUT_MS,
  intervalMs = 500,
  requestTimeoutMs = 1000,
  fetchImpl = fetch,
  isReadyResponse,
  readyFilePath,
  readyFileContents,
  readyLogFilePath,
  readyLogInitialOffset,
  readyLogPattern,
}: WaitForServerReadyConfig): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  const candidateUrls = expandLoopbackProbeUrls(url);

  while (Date.now() < deadline) {
    if (
      waitForReadySignal({
        readyFilePath,
        readyFileContents,
        readyLogFilePath,
        readyLogInitialOffset,
        readyLogPattern,
      })
    ) {
      return true;
    }

    for (const candidateUrl of candidateUrls) {
      if (
        await probeCandidateUrl({
          candidateUrl,
          requestTimeoutMs,
          fetchImpl,
          isReadyResponse,
        })
      ) {
        return true;
      }
    }

    await sleep(intervalMs);
  }
  return false;
};

export const ensureTrailingNewline = (script: string) =>
  script.endsWith("\n") ? script : `${script}\n`;

export const installCompletionScript = (script: string, targetPath: string) => {
  const resolvedPath = resolve(targetPath);
  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, ensureTrailingNewline(script), "utf8");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while writing completion script";
    return { ok: false, message } as const;
  }

  return { ok: true, path: resolvedPath } as const;
};

export const getErrnoCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : null;

export const writeCurrentProcessLockFile = (lockFilePath: string) => {
  try {
    writeFileSync(lockFilePath, `${process.pid}\n`, { flag: "wx" });
    return true;
  } catch (error) {
    if (getErrnoCode(error) === "EEXIST") {
      return false;
    }

    throw error;
  }
};

export const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const isHiveReadyResponse = async (response: Response) => {
  try {
    return isHiveHealthResponse(await response.json());
  } catch {
    return false;
  }
};

const emitStatus = (
  config: DaemonRuntimeConfig,
  event: Omit<DaemonStartupEvent, "healthcheckUrl" | "timestamp">
) => {
  config.onStatus?.({
    ...event,
    healthcheckUrl: config.healthcheckUrl,
    timestamp: Date.now(),
  });
};

const ensureDirectory = (path: string) => {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    /* ignore */
  }
};

const ensurePidDirectory = (config: DaemonRuntimeConfig) => {
  ensureDirectory(dirname(config.pidFilePath));
};

const cleanupFile = (path: string) => {
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
};

const readPidFile = (path: string, cleanup: () => void) => {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!pid || Number.isNaN(pid)) {
      cleanup();
      return null;
    }
    return pid;
  } catch {
    return null;
  }
};

const cleanupPidFile = (config: DaemonRuntimeConfig) => {
  cleanupFile(config.pidFilePath);
};

const cleanupReadyFile = (config: DaemonRuntimeConfig) => {
  cleanupFile(config.readyFilePath);
};

const cleanupStartLock = (config: DaemonRuntimeConfig) => {
  cleanupFile(config.startLockFilePath);
};

const readActivePid = (config: DaemonRuntimeConfig) =>
  readPidFile(config.pidFilePath, () => cleanupPidFile(config));

const readManagedDaemonPid = (config: DaemonRuntimeConfig) => {
  const pid = readActivePid(config);
  if (!pid) {
    return null;
  }

  if (isPidAlive(pid)) {
    return pid;
  }

  cleanupPidFile(config);
  return null;
};

const readStartLockPid = (config: DaemonRuntimeConfig) => {
  const pid = readPidFile(config.startLockFilePath, () =>
    cleanupStartLock(config)
  );
  if (!pid) {
    return null;
  }

  if (isPidAlive(pid)) {
    return pid;
  }

  cleanupStartLock(config);
  return null;
};

const persistPidFile = (config: DaemonRuntimeConfig, pid: number | null) => {
  ensurePidDirectory(config);
  if (!pid) {
    return;
  }
  try {
    writeFileSync(config.pidFilePath, String(pid));
  } catch {
    /* ignore */
  }
};

const persistStartLock = (config: DaemonRuntimeConfig, pid: number | null) => {
  if (!pid) {
    return;
  }

  ensurePidDirectory(config);
  try {
    writeFileSync(config.startLockFilePath, `${pid}\n`);
  } catch {
    /* ignore */
  }
};

const persistPidFileIfAlive = (
  config: DaemonRuntimeConfig,
  pid: number | null
) => {
  if (!(pid && isPidAlive(pid))) {
    return false;
  }

  const listeningPid = findHealthcheckProcessId(config.healthcheckUrl);
  if (listeningPid && listeningPid !== pid) {
    return false;
  }

  persistPidFile(config, pid);
  cleanupStartLock(config);
  return true;
};

const persistLaunchedOrListeningDaemonPid = (
  config: DaemonRuntimeConfig,
  pid: number | null
) => {
  if (persistPidFileIfAlive(config, pid)) {
    return true;
  }

  return persistPidFileIfAlive(
    config,
    findHealthcheckProcessId(config.healthcheckUrl)
  );
};

const detectManagedDaemon = async (config: DaemonRuntimeConfig) => {
  const pid = readManagedDaemonPid(config);
  if (!pid) {
    return null;
  }

  const startupPid = readStartLockPid(config);
  const ready = await waitForServerReady({
    intervalMs: MANAGED_DAEMON_VERIFY_INTERVAL_MS,
    isReadyResponse: isHiveReadyResponse,
    timeoutMs: MANAGED_DAEMON_VERIFY_TIMEOUT_MS,
    url: config.healthcheckUrl,
  });
  if (!ready) {
    if (startupPid === pid) {
      return { pid };
    }

    cleanupPidFile(config);
    return null;
  }

  const listeningPid = findHealthcheckProcessId(config.healthcheckUrl);
  if (listeningPid && listeningPid !== pid) {
    cleanupPidFile(config);
    return null;
  }

  return { pid };
};

const detectUnmanagedDaemon = async (
  config: DaemonRuntimeConfig
): Promise<{ pid: number | null } | null> => {
  if (await detectManagedDaemon(config)) {
    return null;
  }

  const healthPayload = await probeJson(config.healthcheckUrl);
  if (!isHiveHealthResponse(healthPayload)) {
    return null;
  }

  return {
    pid: findHealthcheckProcessId(config.healthcheckUrl),
  };
};

const detectRunningDaemon = async (
  config: DaemonRuntimeConfig
): Promise<RunningDaemon | null> => {
  emitStatus(config, {
    phase: "detecting-daemon",
    message: "Detecting Hive daemon",
  });

  const managedDaemon = await detectManagedDaemon(config);
  if (managedDaemon) {
    return {
      managed: true,
      pid: managedDaemon.pid,
    };
  }

  const unmanagedDaemon = await detectUnmanagedDaemon(config);
  if (!unmanagedDaemon) {
    return null;
  }

  return {
    managed: false,
    pid: unmanagedDaemon.pid,
  };
};

const tryAcquireStartLock = (config: DaemonRuntimeConfig) => {
  if (readStartLockPid(config)) {
    return false;
  }

  ensurePidDirectory(config);
  return writeCurrentProcessLockFile(config.startLockFilePath);
};

export const closeStream = (fd: number | null) => {
  if (fd === null) {
    return;
  }
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
};

export const openLogStreams = (logFile: string) => ({
  stdoutFd: openSync(logFile, "a"),
  stderrFd: openSync(logFile, "a"),
});

export const detachedReadyFileMatchesLaunch = (
  readyFilePath: string,
  launch: DaemonLaunchResult
) => {
  if (!existsSync(readyFilePath)) {
    return false;
  }

  try {
    const readyFileValue = readFileSync(readyFilePath, "utf8").trim();
    return launch.readyFileContents
      ? readyFileValue === launch.readyFileContents
      : readyFileValue.length > 0;
  } catch {
    return false;
  }
};

export const probeJson = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DAEMON_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const spawnDetachedShell = (args: {
  executablePath: string;
  foregroundArgs?: readonly string[];
  logFile: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => {
  const command =
    'executable="$1"; log_file="$2"; shift 2; setsid "$executable" "$@" >"$log_file" 2>&1 < /dev/null &';

  return spawn(
    "sh",
    [
      "-c",
      command,
      "hive-detached",
      args.executablePath,
      args.logFile,
      ...(args.foregroundArgs ?? []),
    ],
    {
      cwd: args.cwd,
      env: args.env,
      detached: true,
      stdio: "ignore",
    }
  );
};

export const launchDetachedProcessWithSpawn = (args: {
  executablePath: string;
  foregroundArgs?: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFile: string;
  logOffset: number;
  persistStartLock: (pid: number | null) => void;
  cleanupStartLock: () => void;
}): DaemonLaunchResult => {
  const { stdoutFd, stderrFd } = openLogStreams(args.logFile);

  try {
    const child = spawn(args.executablePath, [...(args.foregroundArgs ?? [])], {
      cwd: args.cwd,
      env: args.env,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    closeStream(stdoutFd);
    closeStream(stderrFd);

    child.unref();
    args.persistStartLock(child.pid ?? null);
    return {
      pid: child.pid ?? null,
      logFile: args.logFile,
      logOffset: args.logOffset,
      readyFileContents: child.pid ? String(child.pid) : undefined,
    };
  } catch (error) {
    closeStream(stdoutFd);
    closeStream(stderrFd);
    args.cleanupStartLock();
    throw error;
  }
};

export const waitForDetachedReadyFile = async (args: {
  readyFilePath: string;
  launch: DaemonLaunchResult;
  timeoutMs?: number;
}) => {
  if (!(process.platform !== "win32" && args.launch.pid)) {
    return false;
  }

  const deadline =
    Date.now() +
    Math.min(
      args.timeoutMs ?? DETACHED_DAEMON_READY_TIMEOUT_MS,
      DETACHED_READY_FILE_PREWAIT_TIMEOUT_MS
    );
  while (Date.now() < deadline) {
    if (detachedReadyFileMatchesLaunch(args.readyFilePath, args.launch)) {
      return true;
    }

    await sleep(DETACHED_DAEMON_READY_INTERVAL_MS);
  }

  return false;
};

const prepareDetachedLaunch = (config: DaemonRuntimeConfig) => {
  ensureDirectory(dirname(config.logFilePath));
  const logOffset = existsSync(config.logFilePath)
    ? statSync(config.logFilePath).size
    : 0;
  cleanupReadyFile(config);

  const childEnv: Record<string, string | undefined> = {
    ...(config.env ?? process.env),
    HIVE_FOREGROUND: "1",
    HIVE_WORKSPACE_ROOT: config.workspaceRoot,
  };
  for (const key of config.envStripKeys ?? []) {
    delete childEnv[key];
  }

  return { childEnv, logFile: config.logFilePath, logOffset };
};

const launchDetachedServerWithSpawn = (
  config: DaemonRuntimeConfig,
  childEnv: NodeJS.ProcessEnv,
  logFile: string,
  logOffset: number
): LaunchResult =>
  launchDetachedProcessWithSpawn({
    executablePath: config.executablePath,
    foregroundArgs: config.foregroundArgs,
    cwd: config.detachedCwd,
    env: childEnv,
    logFile,
    logOffset,
    persistStartLock: (pid) => persistStartLock(config, pid),
    cleanupStartLock: () => cleanupStartLock(config),
  });

const launchDetachedServer = (config: DaemonRuntimeConfig): LaunchResult => {
  const { childEnv, logFile, logOffset } = prepareDetachedLaunch(config);
  const foregroundArgs = config.foregroundArgs ?? [];

  if (process.platform !== "win32" && config.useShellDetach !== false) {
    try {
      const child = spawnDetachedShell({
        executablePath: config.executablePath,
        foregroundArgs,
        logFile,
        cwd: config.detachedCwd,
        env: childEnv,
      });

      child.unref();
      persistStartLock(config, child.pid ?? null);
      return { pid: child.pid ?? null, logFile, logOffset };
    } catch {
      return launchDetachedServerWithSpawn(
        config,
        childEnv,
        logFile,
        logOffset
      );
    }
  }

  return launchDetachedServerWithSpawn(config, childEnv, logFile, logOffset);
};

const waitForDetachedDaemonReady = async (
  config: DaemonRuntimeConfig,
  launch: LaunchResult,
  waitConfig?: Omit<WaitForServerReadyConfig, "url">
) =>
  await waitForDetachedReadyFile({
    readyFilePath: config.readyFilePath,
    launch,
    timeoutMs: waitConfig?.timeoutMs,
  });

const reuseStartingDaemon = async (
  config: DaemonRuntimeConfig,
  waitConfig?: Omit<WaitForServerReadyConfig, "url">
) => {
  const startupPid = readStartLockPid(config);
  if (!startupPid) {
    return false;
  }

  emitStatus(config, {
    phase: "waiting-for-api",
    message: "Waiting for Hive daemon that is already starting",
    pid: startupPid,
  });

  const startupReady = await waitForServerReady({
    isReadyResponse: isHiveReadyResponse,
    url: config.healthcheckUrl,
    ...waitConfig,
  });
  if (!startupReady) {
    return false;
  }

  persistPidFileIfAlive(config, startupPid);
  return true;
};

const startDetachedManagedDaemon = async (
  config: DaemonRuntimeConfig,
  waitConfig?: Omit<WaitForServerReadyConfig, "url">
) => {
  if (!config.executablePath) {
    emitStatus(config, {
      phase: "error",
      message: "Hive daemon executable is not configured",
    });
    return false;
  }

  if (!tryAcquireStartLock(config)) {
    if (await reuseStartingDaemon(config, waitConfig)) {
      return true;
    }

    emitStatus(config, {
      phase: "error",
      message: "Hive is already starting in another process",
    });
    return false;
  }

  emitStatus(config, {
    phase: "starting-daemon",
    message: "Starting Hive daemon",
  });

  const launch = launchDetachedServer(config);

  if (await waitForDetachedDaemonReady(config, launch, waitConfig)) {
    persistLaunchedOrListeningDaemonPid(config, launch.pid);
    emitStatus(config, {
      phase: "api-ready",
      message: "Hive daemon is ready",
      pid: launch.pid,
    });
    return true;
  }

  emitStatus(config, {
    phase: "waiting-for-api",
    message: "Waiting for Hive daemon API",
    pid: launch.pid,
  });

  const ready = await waitForServerReady({
    isReadyResponse: isHiveReadyResponse,
    readyFilePath: config.readyFilePath,
    readyFileContents: launch.readyFileContents,
    readyLogFilePath: launch.logFile,
    readyLogInitialOffset: launch.logOffset,
    readyLogPattern: DAEMON_READY_LOG_PATTERN,
    url: config.healthcheckUrl,
    ...waitConfig,
  });
  if (!ready) {
    emitStatus(config, {
      phase: "error",
      message: "Hive daemon did not become ready before timeout",
      pid: launch.pid,
    });
    return false;
  }

  persistLaunchedOrListeningDaemonPid(config, launch.pid);
  emitStatus(config, {
    phase: "api-ready",
    message: "Hive daemon is ready",
    pid: launch.pid,
  });
  return true;
};

export const createDaemonRuntime = (config: DaemonRuntimeConfig) => {
  const ensureRunning = async (
    waitConfig?: Omit<WaitForServerReadyConfig, "url">
  ) => {
    try {
      if (await reuseStartingDaemon(config, waitConfig)) {
        return true;
      }

      const runningDaemon = await detectRunningDaemon(config);
      if (runningDaemon?.managed) {
        emitStatus(config, {
          phase: "api-ready",
          message: "Reusing managed Hive daemon",
          pid: runningDaemon.pid,
        });
        return true;
      }

      if (runningDaemon) {
        persistPidFileIfAlive(config, runningDaemon.pid);
        emitStatus(config, {
          phase: "api-ready",
          message: "Reusing running Hive daemon",
          pid: runningDaemon.pid,
        });
        return true;
      }

      return await startDetachedManagedDaemon(config, waitConfig);
    } catch (error) {
      emitStatus(config, {
        phase: "error",
        message: "Failed to start Hive daemon",
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  return {
    detectRunningDaemon: () => detectRunningDaemon(config),
    ensureRunning,
    readManagedDaemonPid: () => readManagedDaemonPid(config),
    readStartLockPid: () => readStartLockPid(config),
  };
};
