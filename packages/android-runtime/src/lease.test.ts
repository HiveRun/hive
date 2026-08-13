import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AndroidRuntimeLeaseOwner,
  acquireAndroidLease,
  acquireAndroidRuntimeLease,
  defaultAndroidLeasePath,
  defaultAndroidRuntimeRegistryPath,
  defaultLegacyAndroidLeasePath,
  getAndroidProcessFingerprint,
  isAndroidLeaseOwnerAlive,
  readAndroidLeaseOwner,
  readAndroidRuntimeLeaseForCell,
} from "./lease";

const LINUX_FINGERPRINT_PATTERN = /^linux-proc:/;
const POSIX_FINGERPRINT_PATTERN = /^ps-lstart:/;
const MISSING_PROCESS_ID = 2_147_483_647;
const FIRST_RUNTIME_CONSOLE_PORT = 5554;
const SECOND_RUNTIME_CONSOLE_PORT = 5556;
const STALE_GRPC_PORT = 8600;
const NEXT_GRPC_PORT = 8602;
const THIRD_GRPC_PORT = 8604;
const RECOVERY_OVERLAP_WAIT_MS = 20;
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

  const seedRuntimeLease = async (
    registryPath: string,
    consolePort: number,
    owner: Record<string, unknown>
  ) => {
    await fs.mkdir(`${registryPath}/slots`, { recursive: true });
    await seedLease(`${registryPath}/slots/${consolePort}`, {
      ...STALE_OWNER,
      avdName: "Hive_Pixel_7_stale",
      consolePort,
      grpcPort: 8600,
      serial: `emulator-${consolePort}`,
      ...owner,
    });
  };

  const seedCorruptRuntimeLease = async (
    registryPath: string,
    consolePort = FIRST_RUNTIME_CONSOLE_PORT
  ) => {
    const leasePath = `${registryPath}/slots/${consolePort}`;
    await fs.mkdir(leasePath, { recursive: true });
    await fs.writeFile(`${leasePath}/owner.json`, "{");
    return leasePath;
  };

  const acquireAfterFailedRecovery = (registryPath: string, grpcPort: number) =>
    acquireAndroidRuntimeLease({
      areConsolePortsAvailable: () => Promise.resolve(true),
      avdName: "Hive_Pixel_7_cell-a",
      cellId: "cell-a",
      grpcPort,
      isProcessAlive: () => false,
      recoverStaleOwner: () => Promise.reject(new Error("cannot stop stale")),
      registryPath,
    });

  const acquireRuntimeTestLease = (
    registryPath: string,
    options: {
      grpcPort?: number;
      isProcessAlive?: (pid: number) => boolean;
      isSerialAvailable?: (serial: string) => boolean;
      recoverStaleOwner?: (owner: AndroidRuntimeLeaseOwner) => Promise<void>;
    } = {}
  ) =>
    acquireAndroidRuntimeLease({
      areConsolePortsAvailable: () => Promise.resolve(true),
      avdName: "Hive_Pixel_7_cell-a",
      cellId: "cell-a",
      grpcPort: options.grpcPort ?? STALE_GRPC_PORT,
      isProcessAlive: options.isProcessAlive,
      isSerialAvailable: options.isSerialAvailable,
      recoverStaleOwner: options.recoverStaleOwner,
      registryPath,
    });

  it("uses a user-owned host-global lease and a stable process-start fingerprint", () => {
    expect(defaultAndroidLeasePath).toBe(`${homedir()}/.hive/runtime/android`);
    expect(defaultLegacyAndroidLeasePath).toContain(
      `calibrate-hive-android-${process.getuid?.() ?? "user"}`
    );
    expect(defaultAndroidRuntimeRegistryPath).toBe(
      `${homedir()}/.hive/runtime/android-v2`
    );
    expect(getAndroidProcessFingerprint(process.pid)).toMatch(
      process.platform === "linux"
        ? LINUX_FINGERPRINT_PATTERN
        : POSIX_FINGERPRINT_PATTERN
    );
  });

  it("allocates distinct host console slots to concurrent cells", async () => {
    const registryPath = await createLeasePath();
    const first = await acquireAndroidRuntimeLease({
      areConsolePortsAvailable: () => Promise.resolve(true),
      avdName: "Hive_Pixel_7",
      cellId: "cell-a",
      grpcPort: 8600,
      getProcessFingerprint: () => "current-start",
      isProcessAlive: () => true,
      registryPath,
    });
    const second = await acquireAndroidRuntimeLease({
      areConsolePortsAvailable: () => Promise.resolve(true),
      avdName: "Hive_Pixel_7",
      cellId: "cell-b",
      grpcPort: 8602,
      getProcessFingerprint: () => "current-start",
      isProcessAlive: () => true,
      registryPath,
    });

    try {
      expect(first.owner.serial).toBe("emulator-5554");
      expect(second.owner.serial).toBe("emulator-5556");
      expect(
        (await readAndroidRuntimeLeaseForCell("cell-a", registryPath))?.owner
          .serial
      ).toBe("emulator-5554");
      expect(
        (await readAndroidRuntimeLeaseForCell("cell-b", registryPath))?.owner
          .serial
      ).toBe("emulator-5556");
    } finally {
      await Promise.all([first.release(), second.release()]);
    }

    expect(
      await readAndroidRuntimeLeaseForCell("cell-a", registryPath)
    ).toBeNull();
    expect(
      await readAndroidRuntimeLeaseForCell("cell-b", registryPath)
    ).toBeNull();
  });

  it("records the exact product process in the owned runtime slot", async () => {
    const registryPath = await createLeasePath();
    const lease = await acquireRuntimeTestLease(registryPath);
    try {
      await lease.recordProductProcess(process.pid, "product-marker");
      const persistedOwner = JSON.parse(
        await fs.readFile(`${lease.leasePath}/owner.json`, "utf8")
      ) as AndroidRuntimeLeaseOwner;
      expect(persistedOwner.productPid).toBe(process.pid);
      expect(persistedOwner.productMarker).toBe("product-marker");
      expect(persistedOwner.productFingerprint).toBe(
        getAndroidProcessFingerprint(process.pid)
      );
      expect(await fs.readFile(`${lease.leasePath}/token`, "utf8")).toBe(
        lease.owner.token
      );
    } finally {
      await lease.release();
    }
  });

  it("never allocates the migration-reserved emulator-5580 slot", async () => {
    const registryPath = await createLeasePath();
    await expect(
      acquireAndroidRuntimeLease({
        areConsolePortsAvailable: () => Promise.resolve(true),
        avdName: "Hive_Pixel_7_cell-a",
        cellId: "cell-a",
        grpcPort: 8600,
        isSerialAvailable: (serial) => serial === "emulator-5580",
        registryPath,
      })
    ).rejects.toThrow("No Android emulator console slots");
  });

  it("reclaims inactive corrupt slots and quarantines unrecoverable stale slots", async () => {
    const registryPath = await createLeasePath();
    const slotsPath = `${registryPath}/slots`;
    const isProcessAlive = () => false;
    const recoverStaleOwner = () =>
      Promise.reject(new Error("cannot stop stale"));
    await seedCorruptRuntimeLease(registryPath);
    await seedLease(`${slotsPath}/5556`, {
      ...STALE_OWNER,
      avdName: "Hive_Pixel_7_stale",
      consolePort: 5556,
      grpcPort: 8604,
      serial: "emulator-5556",
    });

    const lease = await acquireRuntimeTestLease(registryPath, {
      grpcPort: 8600,
      isProcessAlive,
      recoverStaleOwner,
    });
    try {
      expect(lease.owner.serial).toBe("emulator-5554");
    } finally {
      await lease.release();
    }
  });

  it("retains a corrupt slot when its emulator serial may still be active", async () => {
    const registryPath = await createLeasePath();
    const corruptLeasePath = await seedCorruptRuntimeLease(registryPath);

    const lease = await acquireRuntimeTestLease(registryPath, {
      isSerialAvailable: (serial) => serial !== "emulator-5554",
    });
    try {
      expect(lease.owner.serial).toBe("emulator-5556");
      await expect(fs.stat(corruptLeasePath)).resolves.toBeDefined();
    } finally {
      await lease.release();
    }
  });

  it("never recovers a cross-wired slot through another emulator identity", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {
      consolePort: SECOND_RUNTIME_CONSOLE_PORT,
      serial: `emulator-${SECOND_RUNTIME_CONSOLE_PORT}`,
    });
    const recoveredSerials: string[] = [];

    const lease = await acquireRuntimeTestLease(registryPath, {
      isSerialAvailable: (serial) => serial !== "emulator-5554",
      recoverStaleOwner: (owner) => {
        recoveredSerials.push(owner.serial);
        return Promise.resolve();
      },
    });
    try {
      expect(lease.owner.serial).toBe("emulator-5556");
      expect(recoveredSerials).toEqual([]);
    } finally {
      await lease.release();
    }
  });

  it("rejects gRPC ports that overlap a live console slot", async () => {
    const registryPath = await createLeasePath();
    const first = await acquireAndroidRuntimeLease({
      areConsolePortsAvailable: () => Promise.resolve(true),
      avdName: "Hive_Pixel_7_cell-a",
      cellId: "cell-a",
      grpcPort: 8600,
      isProcessAlive: () => true,
      registryPath,
    });
    try {
      await expect(
        acquireAndroidRuntimeLease({
          areConsolePortsAvailable: () => Promise.resolve(true),
          avdName: "Hive_Pixel_7_cell-b",
          cellId: "cell-b",
          grpcPort: first.owner.consolePort + 1,
          isProcessAlive: () => true,
          registryPath,
        })
      ).rejects.toThrow("conflicts with an active emulator slot");
    } finally {
      await first.release();
    }
  });

  it("reserves ports when stale emulator recovery fails", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {});

    await expect(
      acquireAfterFailedRecovery(registryPath, STALE_GRPC_PORT)
    ).rejects.toThrow("conflicts with an active emulator slot");
  });

  it("does not allocate a second slot when its stale emulator cannot stop", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {
      avdName: "Hive_Pixel_7_cell-a",
      cellId: "cell-a",
    });

    await expect(
      acquireAfterFailedRecovery(registryPath, NEXT_GRPC_PORT)
    ).rejects.toThrow("Could not recover Android emulator emulator-5554");
  });

  it("prefers a live cell lease over a retained stale match", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {
      cellId: "cell-a",
      pid: MISSING_PROCESS_ID,
    });
    await seedRuntimeLease(registryPath, SECOND_RUNTIME_CONSOLE_PORT, {
      avdName: "Hive_Pixel_7_live",
      cellId: "cell-a",
      grpcPort: NEXT_GRPC_PORT,
      pid: process.pid,
      token: "live",
    });

    expect(
      (await readAndroidRuntimeLeaseForCell("cell-a", registryPath))?.owner
        .serial
    ).toBe("emulator-5556");
  });

  it("recovers independent stale emulators concurrently", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {});
    await seedRuntimeLease(registryPath, SECOND_RUNTIME_CONSOLE_PORT, {
      grpcPort: NEXT_GRPC_PORT,
    });
    let activeRecoveries = 0;
    let maximumActiveRecoveries = 0;
    const checkConsolePorts = () => Promise.resolve(true);
    const processIsDead = () => false;

    const lease = await acquireAndroidRuntimeLease({
      areConsolePortsAvailable: checkConsolePorts,
      avdName: "Hive_Pixel_7_cell-a",
      cellId: "cell-a",
      grpcPort: THIRD_GRPC_PORT,
      isProcessAlive: processIsDead,
      recoverStaleOwner: async () => {
        activeRecoveries += 1;
        maximumActiveRecoveries = Math.max(
          maximumActiveRecoveries,
          activeRecoveries
        );
        await sleep(RECOVERY_OVERLAP_WAIT_MS);
        activeRecoveries -= 1;
      },
      registryPath,
    });
    try {
      expect(maximumActiveRecoveries).toBe(2);
    } finally {
      await lease.release();
    }
  });

  it("settles every stale recovery before releasing the allocation lock", async () => {
    const registryPath = await createLeasePath();
    await seedRuntimeLease(registryPath, FIRST_RUNTIME_CONSOLE_PORT, {
      cellId: "cell-a",
    });
    await seedRuntimeLease(registryPath, SECOND_RUNTIME_CONSOLE_PORT, {
      grpcPort: NEXT_GRPC_PORT,
    });
    let otherCellRecovered = false;

    await expect(
      acquireAndroidRuntimeLease({
        areConsolePortsAvailable: () => Promise.resolve(true),
        avdName: "Hive_Pixel_7_cell-a",
        cellId: "cell-a",
        grpcPort: THIRD_GRPC_PORT,
        isProcessAlive: () => false,
        recoverStaleOwner: async (owner) => {
          if (owner.cellId === "cell-a") {
            throw new Error("cannot stop same-cell emulator");
          }
          await sleep(RECOVERY_OVERLAP_WAIT_MS);
          otherCellRecovered = true;
        },
        registryPath,
      })
    ).rejects.toThrow("Could not recover Android emulator emulator-5554");
    expect(otherCellRecovered).toBe(true);
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
    for (const pid of [-1, 0, 1, Number.NaN]) {
      expect(
        isAndroidLeaseOwnerAlive({
          cellId: "cell-a",
          pid,
          token: "token-a",
        })
      ).toBe(false);
    }
  });

  it("rejects persisted owners with unsafe process ids", async () => {
    for (const pid of [-1, 0, 1, Number.NaN]) {
      const leasePath = await createLeasePath();
      await seedLease(leasePath, { cellId: "cell-a", pid, token: "token-a" });
      expect(await readAndroidLeaseOwner(leasePath)).toBeNull();
    }
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
