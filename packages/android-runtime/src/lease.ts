import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type AndroidLeaseOwner = {
  cellId: string;
  fingerprint?: string;
  pid: number;
  token: string;
};

type AcquireAndroidLeaseOptions = {
  cellId: string;
  getProcessFingerprint?: (pid: number) => string | null;
  isProcessAlive?: (pid: number) => boolean;
  leasePath?: string;
  recoverStaleOwner?: (owner: AndroidLeaseOwner) => Promise<void>;
};

type AcquireAndroidRuntimeLeaseOptions = AcquireAndroidLeaseOptions & {
  getLegacyProcessFingerprint?: (pid: number) => string | null;
  legacyLeasePath?: string;
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
      typeof value.pid === "number" &&
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

const isProcessAlive = (pid: number): boolean => {
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
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
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

export async function acquireAndroidRuntimeLease({
  getLegacyProcessFingerprint:
    readLegacyProcessFingerprint = readPsProcessStartTime,
  legacyLeasePath = defaultLegacyAndroidLeasePath,
  ...options
}: AcquireAndroidRuntimeLeaseOptions): Promise<() => Promise<void>> {
  // Keep the former Calibrate lease during migration so old and new cells
  // cannot concurrently claim the reserved emulator.
  const releaseLegacyLease = await acquireAndroidLease({
    ...options,
    getProcessFingerprint: readLegacyProcessFingerprint,
    leasePath: legacyLeasePath,
  });
  try {
    const releaseLease = await acquireAndroidLease(options);
    return async () => {
      await Promise.all([releaseLease(), releaseLegacyLease()]);
    };
  } catch (error) {
    await releaseLegacyLease();
    throw error;
  }
}
