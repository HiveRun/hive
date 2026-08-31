import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { HIVE_ANDROID_CONSOLE_PORTS, resolveHiveAndroidSerial } from "./facts";

type AndroidLeaseOwner = {
  cellId: string;
  fingerprint?: string;
  pid: number;
  token: string;
};

export type AndroidRuntimeLeaseOwner = AndroidLeaseOwner & {
  avdName: string;
  consolePort: number;
  grpcPort: number;
  productFingerprint?: string;
  productMarker?: string;
  productPid?: number;
  serial: string;
};

type AndroidRuntimeLease = {
  leasePath: string;
  owner: AndroidRuntimeLeaseOwner;
  recordProductProcess: (pid: number, marker: string) => Promise<void>;
  release: () => Promise<void>;
};

type AcquireAndroidLeaseOptions = {
  cellId: string;
  getProcessFingerprint?: (pid: number) => string | null;
  isProcessAlive?: (pid: number) => boolean;
  leasePath?: string;
  recoverStaleOwner?: (owner: AndroidLeaseOwner) => Promise<void>;
};

type AcquireAndroidRuntimeLeaseOptions = {
  areConsolePortsAvailable?: (consolePort: number) => Promise<boolean>;
  avdName: string;
  cellId: string;
  getProcessFingerprint?: (pid: number) => string | null;
  grpcPort: number;
  isProcessAlive?: (pid: number) => boolean;
  isSerialAvailable?: (serial: string) => boolean;
  recoverStaleOwner?: (owner: AndroidRuntimeLeaseOwner) => Promise<void>;
  registryPath?: string;
};

const RECOVERY_WAIT_TIMEOUT_MS = 45_000;
const RECOVERY_POLL_INTERVAL_MS = 25;
export const defaultAndroidLeasePath = join(
  homedir(),
  ".hive",
  "runtime",
  "android"
);

export const defaultLegacyAndroidLeasePath = join(
  tmpdir(),
  `calibrate-hive-android-${process.getuid?.() ?? "user"}`
);

export const defaultAndroidRuntimeRegistryPath = join(
  homedir(),
  ".hive",
  "runtime",
  "android-v2"
);

const hasErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const readAndroidLeaseOwner = async (
  leasePath: string = defaultAndroidLeasePath
): Promise<AndroidLeaseOwner | null> => {
  try {
    const value = JSON.parse(
      await readFile(join(leasePath, "owner.json"), "utf8")
    ) as Partial<AndroidLeaseOwner>;
    return typeof value.cellId === "string" &&
      Number.isSafeInteger(value.pid) &&
      (value.pid ?? 0) > 1 &&
      typeof value.token === "string"
      ? (value as AndroidLeaseOwner)
      : null;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
};

const isAndroidRuntimeLeaseOwner = (
  owner: AndroidLeaseOwner | null
): owner is AndroidRuntimeLeaseOwner =>
  owner !== null &&
  typeof (owner as Partial<AndroidRuntimeLeaseOwner>).avdName === "string" &&
  Number.isSafeInteger(
    (owner as Partial<AndroidRuntimeLeaseOwner>).consolePort
  ) &&
  Number.isSafeInteger((owner as Partial<AndroidRuntimeLeaseOwner>).grpcPort) &&
  typeof (owner as Partial<AndroidRuntimeLeaseOwner>).serial === "string";

const runtimeOwnerMatchesSlot = (
  owner: AndroidRuntimeLeaseOwner,
  entry: string
) =>
  owner.consolePort === Number(entry) &&
  owner.serial === resolveHiveAndroidSerial(owner.consolePort);

export const readAndroidRuntimeLeaseForCell = async (
  cellId: string,
  registryPath: string = defaultAndroidRuntimeRegistryPath
): Promise<Pick<AndroidRuntimeLease, "leasePath" | "owner"> | null> => {
  const slotsPath = join(registryPath, "slots");
  let entries: string[];
  try {
    entries = await readdir(slotsPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  let staleMatch: Pick<AndroidRuntimeLease, "leasePath" | "owner"> | null =
    null;
  for (const entry of entries) {
    const leasePath = join(slotsPath, entry);
    let owner: AndroidLeaseOwner | null;
    try {
      owner = await readAndroidLeaseOwner(leasePath);
    } catch {
      continue;
    }
    if (
      isAndroidRuntimeLeaseOwner(owner) &&
      runtimeOwnerMatchesSlot(owner, entry) &&
      owner.cellId === cellId
    ) {
      const match = { leasePath, owner };
      if (isAndroidLeaseOwnerAlive(owner)) {
        return match;
      }
      staleMatch ??= match;
    }
  }
  return staleMatch;
};

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
};

const readLinuxProcessStartTime = (pid: number): string | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const startTime = fields[19];
    if (!startTime) {
      return null;
    }
    let bootId = "unknown-boot";
    try {
      bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    } catch {
      // The process start time still protects against PID reuse during this boot.
    }
    return `linux-proc:${bootId}:${startTime}`;
  } catch {
    return null;
  }
};

const readPsProcessStartTime = (pid: number): string | null => {
  const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LANG: "C", LC_ALL: "C", TZ: "UTC" },
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
};

export const getAndroidProcessFingerprint = (pid: number): string | null => {
  if (process.platform === "linux") {
    const fingerprint = readLinuxProcessStartTime(pid);
    if (fingerprint) {
      return fingerprint;
    }
  }
  const startTime = readPsProcessStartTime(pid);
  return startTime ? `ps-lstart:${startTime}` : null;
};

export const isAndroidLeaseOwnerAlive = (owner: AndroidLeaseOwner): boolean => {
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1) {
    return false;
  }
  if (!isProcessAlive(owner.pid)) {
    return false;
  }
  return owner.fingerprint
    ? getAndroidProcessFingerprint(owner.pid) === owner.fingerprint
    : true;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: atomic stale-owner recovery and lease replacement are one transaction.
export async function acquireAndroidLease({
  cellId,
  getProcessFingerprint: readProcessFingerprint = getAndroidProcessFingerprint,
  isProcessAlive: checkProcess = isProcessAlive,
  leasePath = defaultAndroidLeasePath,
  recoverStaleOwner,
}: AcquireAndroidLeaseOptions): Promise<() => Promise<void>> {
  await mkdir(dirname(leasePath), { mode: 0o700, recursive: true });
  const token = randomUUID();
  const recoveryPath = `${leasePath}.recovery`;
  const recoveryDeadline = Date.now() + RECOVERY_WAIT_TIMEOUT_MS;
  const currentOwner = {
    cellId,
    fingerprint: readProcessFingerprint(process.pid) ?? undefined,
    pid: process.pid,
    token,
  } satisfies AndroidLeaseOwner;
  const ownerIsAlive = (owner: AndroidLeaseOwner): boolean => {
    if (!checkProcess(owner.pid)) {
      return false;
    }
    const observedFingerprint = readProcessFingerprint(owner.pid);
    return owner.fingerprint ? observedFingerprint === owner.fingerprint : true;
  };
  const claimDirectory = async (targetPath: string): Promise<boolean> => {
    const preparedPath = `${targetPath}.claim-${token}`;
    await rm(preparedPath, { force: true, recursive: true });
    await mkdir(preparedPath);
    await writeFile(
      join(preparedPath, "owner.json"),
      JSON.stringify(currentOwner)
    );
    try {
      await rename(preparedPath, targetPath);
      return true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOTEMPTY")) {
        return false;
      }
      throw error;
    } finally {
      await rm(preparedPath, { force: true, recursive: true });
    }
  };

  for (;;) {
    if (await claimDirectory(recoveryPath)) {
      break;
    }
    const recoveryOwner = await readAndroidLeaseOwner(recoveryPath);
    if (!(recoveryOwner && ownerIsAlive(recoveryOwner))) {
      await rm(recoveryPath, { force: true, recursive: true });
    } else if (Date.now() >= recoveryDeadline) {
      throw new Error(
        `Timed out waiting for Android emulator lease recovery held by Hive cell ${recoveryOwner.cellId} (pid ${recoveryOwner.pid}).`
      );
    }
    await sleep(RECOVERY_POLL_INTERVAL_MS);
  }

  try {
    if (!(await claimDirectory(leasePath))) {
      const owner = await readAndroidLeaseOwner(leasePath);
      if (owner && ownerIsAlive(owner)) {
        throw new Error(
          `Android emulator is already owned by Hive cell ${owner.cellId} (pid ${owner.pid}). Stop that cell before starting another Android cell.`
        );
      }
      if (owner) {
        await recoverStaleOwner?.(owner);
      }
      await rm(leasePath, { force: true, recursive: true });
      if (!(await claimDirectory(leasePath))) {
        throw new Error(`Could not claim Android emulator lease ${leasePath}.`);
      }
    }
  } finally {
    const recoveryOwner = await readAndroidLeaseOwner(recoveryPath);
    if (recoveryOwner?.token === token) {
      await rm(recoveryPath, { force: true, recursive: true });
    }
  }

  return async () => {
    const owner = await readAndroidLeaseOwner(leasePath);
    if (owner?.token === token) {
      await rm(leasePath, { force: true, recursive: true });
    }
  };
}

const areConsolePortsAvailable = async (consolePort: number) => {
  const canListen = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () =>
        server.close((error) => resolve(!error))
      );
    });
  const availability = await Promise.all([
    canListen(consolePort),
    canListen(consolePort + 1),
  ]);
  return availability.every(Boolean);
};

type AndroidRuntimeLeaseContext = {
  avdName: string;
  cellId: string;
  checkConsolePorts: (consolePort: number) => Promise<boolean>;
  checkProcess: (pid: number) => boolean;
  grpcPort: number;
  isSerialAvailable: (serial: string) => boolean;
  readProcessFingerprint: (pid: number) => string | null;
  recoverStaleOwner?: (owner: AndroidRuntimeLeaseOwner) => Promise<void>;
};

const acquireRuntimeAllocation = async (
  context: AndroidRuntimeLeaseContext,
  allocationPath: string
) => {
  const deadline = Date.now() + RECOVERY_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      return await acquireAndroidLease({
        cellId: context.cellId,
        getProcessFingerprint: context.readProcessFingerprint,
        isProcessAlive: context.checkProcess,
        leasePath: allocationPath,
      });
    } catch (error) {
      const allocationIsBusy =
        error instanceof Error &&
        error.message.includes("already owned by Hive cell");
      if (!allocationIsBusy || Date.now() >= deadline) {
        throw error;
      }
      await sleep(RECOVERY_POLL_INTERVAL_MS);
    }
  }
};

const runtimeOwnerIsAlive = (
  owner: AndroidRuntimeLeaseOwner,
  context: AndroidRuntimeLeaseContext
) =>
  context.checkProcess(owner.pid) &&
  (!owner.fingerprint ||
    context.readProcessFingerprint(owner.pid) === owner.fingerprint);

const reclaimInvalidRuntimeSlot = async (
  context: AndroidRuntimeLeaseContext,
  entry: string,
  leasePath: string
) => {
  const consolePort = Number(entry);
  const serial = resolveHiveAndroidSerial(consolePort);
  if (
    HIVE_ANDROID_CONSOLE_PORTS.includes(consolePort) &&
    context.isSerialAvailable(serial) &&
    (await context.checkConsolePorts(consolePort))
  ) {
    await rm(leasePath, { force: true, recursive: true });
    return;
  }
  process.stderr.write(
    `Retaining invalid Android emulator slot ${entry}; ${serial} or its console ports may still be active.\n`
  );
};

const inspectRuntimeSlot = async (
  context: AndroidRuntimeLeaseContext,
  entry: string,
  leasePath: string
): Promise<AndroidRuntimeLeaseOwner | null> => {
  if (entry.includes(".claim-")) {
    await rm(leasePath, { force: true, recursive: true });
    return null;
  }
  let owner: AndroidLeaseOwner | null;
  try {
    owner = await readAndroidLeaseOwner(leasePath);
  } catch {
    await reclaimInvalidRuntimeSlot(context, entry, leasePath);
    return null;
  }
  if (
    !(
      isAndroidRuntimeLeaseOwner(owner) && runtimeOwnerMatchesSlot(owner, entry)
    )
  ) {
    await reclaimInvalidRuntimeSlot(context, entry, leasePath);
    return null;
  }
  if (runtimeOwnerIsAlive(owner, context)) {
    if (owner.cellId === context.cellId) {
      throw new Error(
        `Hive cell ${context.cellId} already owns Android emulator ${owner.serial}.`
      );
    }
    return owner;
  }
  try {
    await context.recoverStaleOwner?.(owner);
    await rm(leasePath, { force: true, recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Retaining stale Android emulator slot ${owner.serial} after recovery failed: ${message}\n`
    );
    if (owner.cellId === context.cellId) {
      throw new Error(
        `Could not recover Android emulator ${owner.serial} previously owned by Hive cell ${context.cellId}: ${message}`
      );
    }
    return owner;
  }
  return null;
};

const recoverStaleRuntimeSlots = async (
  context: AndroidRuntimeLeaseContext,
  slotsPath: string
): Promise<AndroidRuntimeLeaseOwner[]> => {
  const entries = await readdir(slotsPath);
  const results = await Promise.allSettled(
    entries.map((entry) =>
      inspectRuntimeSlot(context, entry, join(slotsPath, entry))
    )
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
};

const writeRuntimeLeaseOwner = async (
  leasePath: string,
  owner: AndroidRuntimeLeaseOwner
): Promise<boolean> => {
  const preparedPath = `${leasePath}.claim-${owner.token}`;
  await rm(preparedPath, { force: true, recursive: true });
  await mkdir(preparedPath);
  await Promise.all([
    writeFile(join(preparedPath, "owner.json"), JSON.stringify(owner)),
    writeFile(join(preparedPath, "token"), owner.token),
  ]);
  try {
    await rename(preparedPath, leasePath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ENOTEMPTY")) {
      return false;
    }
    throw error;
  } finally {
    await rm(preparedPath, { force: true, recursive: true });
  }
};

const createRuntimeLease = async (
  context: AndroidRuntimeLeaseContext,
  slotsPath: string,
  liveOwners: AndroidRuntimeLeaseOwner[]
): Promise<AndroidRuntimeLease | null> => {
  if (
    liveOwners.some(
      (owner) =>
        context.grpcPort === owner.grpcPort ||
        context.grpcPort === owner.consolePort ||
        context.grpcPort === owner.consolePort + 1
    )
  ) {
    throw new Error(
      `Android emulator gRPC port ${context.grpcPort} conflicts with an active emulator slot.`
    );
  }
  const occupiedSlots = new Set(await readdir(slotsPath));
  for (const consolePort of HIVE_ANDROID_CONSOLE_PORTS) {
    if (
      context.grpcPort === consolePort ||
      context.grpcPort === consolePort + 1
    ) {
      continue;
    }
    if (
      occupiedSlots.has(String(consolePort)) ||
      liveOwners.some(
        (liveOwner) =>
          liveOwner.grpcPort === consolePort ||
          liveOwner.grpcPort === consolePort + 1
      )
    ) {
      continue;
    }
    const leasePath = join(slotsPath, String(consolePort));
    const serial = resolveHiveAndroidSerial(consolePort);
    if (
      !(
        context.isSerialAvailable(serial) &&
        (await context.checkConsolePorts(consolePort))
      )
    ) {
      continue;
    }
    const owner: AndroidRuntimeLeaseOwner = {
      avdName: context.avdName,
      cellId: context.cellId,
      consolePort,
      fingerprint: context.readProcessFingerprint(process.pid) ?? undefined,
      grpcPort: context.grpcPort,
      pid: process.pid,
      serial,
      token: randomUUID(),
    };
    if (!(await writeRuntimeLeaseOwner(leasePath, owner))) {
      continue;
    }
    return {
      leasePath,
      owner,
      recordProductProcess: async (pid: number, marker: string) => {
        const currentOwner = await readAndroidLeaseOwner(leasePath);
        if (currentOwner?.token !== owner.token) {
          throw new Error(
            `Hive cell ${owner.cellId} no longer owns Android emulator ${owner.serial}.`
          );
        }
        owner.productPid = pid;
        owner.productMarker = marker;
        owner.productFingerprint =
          context.readProcessFingerprint(pid) ?? undefined;
        const nextOwnerPath = join(leasePath, `owner.${owner.token}.json`);
        await writeFile(nextOwnerPath, JSON.stringify(owner));
        await rename(nextOwnerPath, join(leasePath, "owner.json"));
      },
      release: async () => {
        const currentOwner = await readAndroidLeaseOwner(leasePath);
        if (currentOwner?.token === owner.token) {
          await rm(leasePath, { force: true, recursive: true });
        }
      },
    };
  }
  return null;
};

export async function acquireAndroidRuntimeLease({
  areConsolePortsAvailable: checkConsolePorts = areConsolePortsAvailable,
  avdName,
  cellId,
  getProcessFingerprint: readProcessFingerprint = getAndroidProcessFingerprint,
  grpcPort,
  isProcessAlive: checkProcess = isProcessAlive,
  isSerialAvailable = () => true,
  recoverStaleOwner,
  registryPath = defaultAndroidRuntimeRegistryPath,
}: AcquireAndroidRuntimeLeaseOptions): Promise<AndroidRuntimeLease> {
  const context: AndroidRuntimeLeaseContext = {
    avdName,
    cellId,
    checkConsolePorts,
    checkProcess,
    grpcPort,
    isSerialAvailable,
    readProcessFingerprint,
    recoverStaleOwner,
  };
  const allocationPath = join(registryPath, "allocation");
  const slotsPath = join(registryPath, "slots");
  const releaseAllocation = await acquireRuntimeAllocation(
    context,
    allocationPath
  );

  try {
    await mkdir(slotsPath, { mode: 0o700, recursive: true });
    const liveOwners = await recoverStaleRuntimeSlots(context, slotsPath);
    const lease = await createRuntimeLease(context, slotsPath, liveOwners);
    if (lease) {
      return lease;
    }
    throw new Error(
      "No Android emulator console slots are available on this host."
    );
  } finally {
    await releaseAllocation();
  }
}
