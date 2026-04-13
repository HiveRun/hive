import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type WaitForServerReadyConfig = {
  url: string;
  timeoutMs?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  isReadyResponse?: (response: Response) => Promise<boolean>;
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

const ADDRESS_PORT_PATTERN = /:(\d+)$/;
const LINE_SPLIT_PATTERN = /\r?\n/;
const COLUMN_SPLIT_PATTERN = /\s+/;
const SS_PID_PATTERN = /pid=(\d+)/;
const NETSTAT_MIN_COLUMNS = 5;
const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;

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

  for (const line of ssResult.stdout.split(LINE_SPLIT_PATTERN)) {
    const pidText = line.match(SS_PID_PATTERN)?.[1];
    if (!pidText) {
      continue;
    }

    const pid = parsePositiveInteger(pidText);
    if (pid) {
      return pid;
    }
  }

  return null;
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

    const pid = parsePositiveInteger(pidText);
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

export const waitForServerReady = async ({
  url,
  timeoutMs = 10_000,
  intervalMs = 500,
  requestTimeoutMs = 1000,
  fetchImpl = fetch,
  isReadyResponse,
}: WaitForServerReadyConfig): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let response: Response | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
      });
    } catch {
      response = null;
    } finally {
      clearTimeout(timeout);
    }

    if (response && (await responseIndicatesReady(response, isReadyResponse))) {
      return true;
    }

    if (response?.body) {
      await response.body.cancel().catch(() => null);
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
