import { promises as fs } from "node:fs";
import { homedir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireAndroidLease,
  defaultAndroidLeasePath,
  getAndroidProcessFingerprint,
  isAndroidLeaseOwnerAlive,
} from "./lease";

const LINUX_FINGERPRINT_PATTERN = /^linux-proc:/;
const POSIX_FINGERPRINT_PATTERN = /^ps-lstart:/;
const STALE_OWNER = { cellId: "stale-cell", pid: 123, token: "stale" };

describe("Android emulator lease", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { force: true, recursive: true }))
    );
  });

  const createLeasePath = async () => {
    const root = await fs.mkdtemp("/tmp/hive-android-lease-test-");
    roots.push(root);
    return `${root}/lease`;
  };

  const seedLease = async (
    leasePath: string,
    owner: Record<string, unknown>
  ): Promise<void> => {
    await fs.mkdir(leasePath);
    await fs.writeFile(`${leasePath}/owner.json`, JSON.stringify(owner));
  };

  it("uses a user-owned host-global lease and a stable process-start fingerprint", () => {
    expect(defaultAndroidLeasePath).toBe(`${homedir()}/.hive/runtime/android`);
    expect(getAndroidProcessFingerprint(process.pid)).toMatch(
      process.platform === "linux"
        ? LINUX_FINGERPRINT_PATTERN
        : POSIX_FINGERPRINT_PATTERN
    );
  });

  it("prevents concurrent cells from owning the emulator", async () => {
    const leasePath = await createLeasePath();
    const release = await acquireAndroidLease({
      cellId: "cell-a",
      isProcessAlive: () => true,
      leasePath,
    });

    try {
      await expect(
        acquireAndroidLease({
          cellId: "cell-b",
          isProcessAlive: () => true,
          leasePath,
        })
      ).rejects.toThrow("already owned by Hive cell cell-a");
    } finally {
      await release();
    }
  });

  it("detects an exited or reused lease owner process", () => {
    const fingerprint = getAndroidProcessFingerprint(process.pid);
    expect(
      isAndroidLeaseOwnerAlive({
        cellId: "cell-a",
        fingerprint: fingerprint ?? undefined,
        pid: process.pid,
        token: "token-a",
      })
    ).toBe(true);
    expect(
      isAndroidLeaseOwnerAlive({
        cellId: "cell-a",
        fingerprint: "different-process-start",
        pid: process.pid,
        token: "token-a",
      })
    ).toBe(false);
    expect(
      isAndroidLeaseOwnerAlive({
        cellId: "cell-a",
        pid: 2_147_483_647,
        token: "token-a",
      })
    ).toBe(false);
  });

  it("recovers a stale owner before replacing it", async () => {
    const leasePath = await createLeasePath();
    await seedLease(leasePath, STALE_OWNER);
    let recoveredCellId: string | undefined;

    const release = await acquireAndroidLease({
      cellId: "cell-a",
      isProcessAlive: () => false,
      leasePath,
      recoverStaleOwner: (owner) => {
        recoveredCellId = owner.cellId;
        return Promise.resolve();
      },
    });
    try {
      const owner = JSON.parse(
        await fs.readFile(`${leasePath}/owner.json`, "utf8")
      ) as { cellId: string };
      expect(recoveredCellId).toBe("stale-cell");
      expect(owner.cellId).toBe("cell-a");
    } finally {
      await release();
    }
  });

  it("treats a reused live pid with a different fingerprint as stale", async () => {
    const leasePath = await createLeasePath();
    await seedLease(leasePath, {
      ...STALE_OWNER,
      fingerprint: "old-process-start",
      pid: process.pid,
    });
    let recovered = false;

    const release = await acquireAndroidLease({
      cellId: "cell-a",
      getProcessFingerprint: () => "new-process-start",
      isProcessAlive: () => true,
      leasePath,
      recoverStaleOwner: () => {
        recovered = true;
        return Promise.resolve();
      },
    });
    try {
      expect(recovered).toBe(true);
    } finally {
      await release();
    }
  });

  it("retains the stale lease when emulator recovery fails", async () => {
    const leasePath = await createLeasePath();
    await seedLease(leasePath, STALE_OWNER);

    await expect(
      acquireAndroidLease({
        cellId: "cell-a",
        isProcessAlive: () => false,
        leasePath,
        recoverStaleOwner: () => Promise.reject(new Error("cleanup failed")),
      })
    ).rejects.toThrow("cleanup failed");
    expect(
      JSON.parse(await fs.readFile(`${leasePath}/owner.json`, "utf8"))
    ).toEqual(STALE_OWNER);
  });

  it("serializes concurrent stale-owner recovery", async () => {
    const leasePath = await createLeasePath();
    await seedLease(leasePath, STALE_OWNER);
    let allowRecovery = (): void => {
      throw new Error("Recovery gate was not initialized");
    };
    let markRecoveryStarted = (): void => {
      throw new Error("Recovery signal was not initialized");
    };
    const recoveryGate = new Promise<void>((resolve) => {
      allowRecovery = resolve;
    });
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve;
    });

    const firstAttempt = acquireAndroidLease({
      cellId: "cell-a",
      isProcessAlive: (pid) => pid === process.pid,
      leasePath,
      recoverStaleOwner: async () => {
        markRecoveryStarted();
        await recoveryGate;
      },
    });
    await recoveryStarted;
    const secondAttempt = acquireAndroidLease({
      cellId: "cell-b",
      isProcessAlive: (pid) => pid === process.pid,
      leasePath,
    });
    allowRecovery();

    const attempts = await Promise.allSettled([firstAttempt, secondAttempt]);
    const acquired = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<() => Promise<void>> =>
        attempt.status === "fulfilled"
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected"
    );

    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toContain("already owned by Hive cell");
    await acquired[0]?.value();
  });
});
