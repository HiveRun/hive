import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCK_ACQUIRE_ATTEMPTS = 2;
const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;
function noopLogger(_message: string) {
  return;
}

const RUNTIME_E2E_COMMAND_MARKERS = [
  "src/runtime/e2e-runner.ts",
  "src/runtime/run-fast.ts",
  "bun run test:e2e",
  "playwright test",
] as const;

export type RuntimeE2ELockMetadata = {
  pid: number;
  startedAt: string;
  command: string;
  cwd: string;
  hostname: string;
};

type ProcessStatus = {
  alive: boolean;
  command: string | null;
};

type AcquireRuntimeE2ELockOptions = {
  lockFilePath: string;
  force?: boolean;
  logger?: (message: string) => void;
  currentPid?: number;
  currentCommand?: string;
  currentCwd?: string;
  currentHostname?: string;
  startedAt?: string;
  readProcessStatus?: (pid: number) => Promise<ProcessStatus>;
};

export type RuntimeE2ELockHandle = {
  bypassed: boolean;
  metadata: RuntimeE2ELockMetadata;
  release: () => Promise<void>;
};

type ExistingLockState =
  | { kind: "missing" }
  | { kind: "stale"; metadata: RuntimeE2ELockMetadata }
  | {
      kind: "active";
      metadata: RuntimeE2ELockMetadata;
      processStatus: ProcessStatus;
    };

type AttemptAcquireResult =
  | { kind: "acquired"; handle: RuntimeE2ELockHandle }
  | { kind: "retry" }
  | { kind: "error"; error: Error };

export async function acquireRuntimeE2ELock(
  options: AcquireRuntimeE2ELockOptions
): Promise<RuntimeE2ELockHandle> {
  const logger = options.logger ?? noopLogger;
  const readProcessStatus =
    options.readProcessStatus ?? defaultReadProcessStatus;
  const metadata = buildLockMetadata(options);

  await mkdir(dirname(options.lockFilePath), { recursive: true });

  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    const result = await attemptAcquireRuntimeE2ELock(
      options,
      metadata,
      logger,
      readProcessStatus
    );

    if (result.kind === "acquired") {
      return result.handle;
    }

    if (result.kind === "retry") {
      continue;
    }

    throw result.error;
  }

  throw new Error(
    `Failed to acquire runtime E2E lock at ${options.lockFilePath}`
  );
}

export function installRuntimeE2ELockSignalCleanup(
  handle: RuntimeE2ELockHandle,
  logger: (message: string) => void = noopLogger
): () => void {
  if (handle.bypassed) {
    return bypassedSignalCleanup;
  }

  const unbinders = [
    bindSignalCleanup(handle, logger, "SIGINT", SIGINT_EXIT_CODE),
    bindSignalCleanup(handle, logger, "SIGTERM", SIGTERM_EXIT_CODE),
  ];

  return () => {
    for (const unbind of unbinders) {
      unbind();
    }
  };
}

function bindSignalCleanup(
  handle: RuntimeE2ELockHandle,
  logger: (message: string) => void,
  signal: NodeJS.Signals,
  exitCode: number
): () => void {
  const listener = () => {
    handle
      .release()
      .catch((error) => {
        logger(
          `Failed to release runtime E2E lock on ${signal}: ${error instanceof Error ? error.message : String(error)}`
        );
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  process.once(signal, listener);

  return () => {
    process.removeListener(signal, listener);
  };
}

function buildLockMetadata(
  options: AcquireRuntimeE2ELockOptions
): RuntimeE2ELockMetadata {
  return {
    pid: options.currentPid ?? process.pid,
    startedAt: options.startedAt ?? new Date().toISOString(),
    command: options.currentCommand ?? process.argv.join(" "),
    cwd: options.currentCwd ?? process.cwd(),
    hostname: options.currentHostname ?? hostname(),
  };
}

function createLockHandle(
  lockFilePath: string,
  metadata: RuntimeE2ELockMetadata
): RuntimeE2ELockHandle {
  return {
    bypassed: false,
    metadata,
    release: () => releaseRuntimeE2ELock(lockFilePath, metadata),
  };
}

function createBypassedLockHandle(
  metadata: RuntimeE2ELockMetadata
): RuntimeE2ELockHandle {
  return {
    bypassed: true,
    metadata,
    release: bypassedLockRelease,
  };
}

function bypassedSignalCleanup() {
  return;
}

function bypassedLockRelease() {
  return Promise.resolve();
}

async function attemptAcquireRuntimeE2ELock(
  options: AcquireRuntimeE2ELockOptions,
  metadata: RuntimeE2ELockMetadata,
  logger: (message: string) => void,
  readProcessStatus: (pid: number) => Promise<ProcessStatus>
): Promise<AttemptAcquireResult> {
  try {
    await writeFile(options.lockFilePath, JSON.stringify(metadata, null, 2), {
      flag: "wx",
    });

    return {
      kind: "acquired",
      handle: createLockHandle(options.lockFilePath, metadata),
    };
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      return { kind: "error", error: asError(error) };
    }

    if (options.force) {
      logger(
        `Bypassing runtime E2E lock at ${options.lockFilePath} because HIVE_E2E_FORCE=1`
      );

      return {
        kind: "acquired",
        handle: createBypassedLockHandle(metadata),
      };
    }

    const existingLockState = await readExistingLockState(
      options.lockFilePath,
      readProcessStatus
    );

    if (existingLockState.kind === "missing") {
      await rm(options.lockFilePath, { force: true });
      return { kind: "retry" };
    }

    if (existingLockState.kind === "stale") {
      logger(
        `Removing stale runtime E2E lock at ${options.lockFilePath} (pid=${String(existingLockState.metadata.pid)})`
      );
      await rm(options.lockFilePath, { force: true });
      return { kind: "retry" };
    }

    return {
      kind: "error",
      error: createActiveLockError(options.lockFilePath, existingLockState),
    };
  }
}

async function releaseRuntimeE2ELock(
  lockFilePath: string,
  metadata: RuntimeE2ELockMetadata
): Promise<void> {
  const existing = await readRuntimeE2ELockMetadata(lockFilePath);

  if (!existing || existing.pid !== metadata.pid) {
    return;
  }

  await rm(lockFilePath, { force: true });
}

async function readExistingLockState(
  lockFilePath: string,
  readProcessStatus: (pid: number) => Promise<ProcessStatus>
): Promise<ExistingLockState> {
  const metadata = await readRuntimeE2ELockMetadata(lockFilePath);

  if (!metadata) {
    return { kind: "missing" };
  }

  const processStatus = await readProcessStatus(metadata.pid);

  if (!processStatus.alive) {
    return { kind: "stale", metadata };
  }

  if (!looksLikeRuntimeE2ECommand(processStatus.command ?? metadata.command)) {
    return { kind: "stale", metadata };
  }

  return {
    kind: "active",
    metadata,
    processStatus,
  };
}

function createActiveLockError(
  lockFilePath: string,
  existingLockState: Extract<ExistingLockState, { kind: "active" }>
): Error {
  return new Error(
    [
      "Another runtime E2E run is already active.",
      `lock=${lockFilePath}`,
      `pid=${String(existingLockState.metadata.pid)}`,
      `startedAt=${existingLockState.metadata.startedAt}`,
      `host=${existingLockState.metadata.hostname}`,
      `command=${existingLockState.processStatus.command ?? existingLockState.metadata.command}`,
      "Wait for it to finish or set HIVE_E2E_FORCE=1 to bypass the lock.",
    ].join(" ")
  );
}

async function readRuntimeE2ELockMetadata(
  lockFilePath: string
): Promise<RuntimeE2ELockMetadata | null> {
  try {
    const raw = await readFile(lockFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeE2ELockMetadata>;

    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.command !== "string" ||
      typeof parsed.cwd !== "string" ||
      typeof parsed.hostname !== "string"
    ) {
      return null;
    }

    return parsed as RuntimeE2ELockMetadata;
  } catch {
    return null;
  }
}

async function defaultReadProcessStatus(pid: number): Promise<ProcessStatus> {
  try {
    process.kill(pid, 0);
  } catch {
    return { alive: false, command: null };
  }

  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "command=",
      "-p",
      String(pid),
    ]);
    const command = stdout.trim();
    return { alive: true, command: command === "" ? null : command };
  } catch {
    return { alive: true, command: null };
  }
}

function looksLikeRuntimeE2ECommand(command: string | null): boolean {
  if (!command) {
    return false;
  }

  return RUNTIME_E2E_COMMAND_MARKERS.some((marker) => command.includes(marker));
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
