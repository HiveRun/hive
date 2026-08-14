import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  getRunningAndroidAvdName,
  isAndroidDevicePresent,
  stopAndroidEmulator,
  waitForAndroidDevice,
  waitForAndroidDeviceToStop,
} from "./android-device";
import {
  type AndroidRuntimeLeaseOwner,
  acquireAndroidRuntimeLease,
  getAndroidProcessFingerprint,
} from "./lease";
import {
  buildAndroidEmulatorArgs,
  createAndroidSdkEnvironment,
  getHiveAndroidAbi,
  getHiveAndroidDeviceStartTimeoutMs,
  getHiveAndroidSystemImage,
  HIVE_ANDROID_DEVICE_PROFILE,
  resolveAndroidGraphics,
  resolveAndroidRuntimeDirectory,
  resolveHiveAndroidAvdName,
  sanitizeAdbServerEnvironment,
} from "./policy";
import {
  forwardSignalsToChildren,
  isProcessGroupRunning,
  terminateChild,
  terminateProcessGroup,
  waitForChildExit,
} from "./process";
import { prepareIsolatedAndroidTools } from "./viewer";

type AndroidToolPaths = {
  adb: string;
  avdManager: string;
  emulator: string;
};

const PRODUCT_GUARDIAN_SCRIPT = `
group_has_members() {
  members=$(/bin/ps -A -o pid= -o pgid= 2>/dev/null) || return 0
  set -- $members
  while [ "$#" -ge 2 ]; do
    member_pid=$1
    member_pgid=$2
    shift 2
    if [ "$member_pgid" = "$$" ] && [ "$member_pid" != "$$" ] && kill -0 "$member_pid" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}
kill_group_members() {
  members=$(/bin/ps -A -o pid= -o pgid= 2>/dev/null) || return
  set -- $members
  while [ "$#" -ge 2 ]; do
    member_pid=$1
    member_pgid=$2
    shift 2
    if [ "$member_pgid" = "$$" ] && [ "$member_pid" != "$$" ]; then
      kill -KILL "$member_pid" 2>/dev/null || true
    fi
  done
}
stop_group() {
  trap '' HUP INT TERM USR1
  kill -TERM -$$ 2>/dev/null || true
  remaining=$shutdown_timeout
  while [ "$remaining" -gt 0 ] && group_has_members; do
    /bin/sleep 1
    remaining=$((remaining - 1))
  done
  if group_has_members; then
    kill_group_members
    remaining=$shutdown_timeout
    while [ "$remaining" -gt 0 ] && group_has_members; do
      /bin/sleep 1
      remaining=$((remaining - 1))
    done
  fi
}
cleanup() {
  stop_group
  if [ -n "$product_pid" ]; then
    wait "$product_pid" 2>/dev/null || true
  fi
  exit 1
}
control_lost() {
  stop_group
  if [ -n "$product_pid" ]; then
    wait "$product_pid" 2>/dev/null || true
  fi
  exit 1
}
trap cleanup HUP INT TERM
trap control_lost USR1
IFS= read -r gate <&3 || exit 1
[ "$gate" = start ] || exit 1
shutdown_timeout=$1
shift
exec 4<&0
"$@" <&4 3<&- 4<&- &
product_pid=$!
guardian_pid=$$
(
  while IFS= read -r _ <&3; do :; done
  kill -USR1 "$guardian_pid" 2>/dev/null || true
) &
pipe_monitor=$!
wait "$product_pid"
status=$?
kill "$pipe_monitor" 2>/dev/null || true
wait "$pipe_monitor" 2>/dev/null || true
trap - HUP INT
stop_group
exit "$status"
`;

export const buildAndroidProductGuardianArgs = (
  marker: string,
  productArgv: string[],
  shutdownTimeoutSeconds = 10
): string[] => [
  "-c",
  PRODUCT_GUARDIAN_SCRIPT,
  marker,
  String(shutdownTimeoutSeconds),
  ...productArgv,
];

const readProcessCommand = (pid: number): string | null => {
  const result = spawnSync(
    "/bin/ps",
    ["-ww", "-o", "command=", "-p", String(pid)],
    { encoding: "utf8" }
  );
  return result.status === 0 ? result.stdout.trim() || null : null;
};

const REQUIRED_ANDROID_TOOL_PATHS = [
  "platform-tools/adb",
  "emulator/emulator",
  "cmdline-tools/latest/bin/avdmanager",
];

const resolveAndroidToolPaths = (sdkPath: string): AndroidToolPaths => ({
  adb: join(sdkPath, "platform-tools", "adb"),
  avdManager: join(sdkPath, "cmdline-tools", "latest", "bin", "avdmanager"),
  emulator: join(sdkPath, "emulator", "emulator"),
});

const assertAndroidTools = (paths: AndroidToolPaths, sdkPath: string): void => {
  const missing = Object.entries(paths)
    .filter(([, path]) => !existsSync(path))
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Android SDK tools (${missing.join(", ")}) were not found under ${sdkPath}. Set ANDROID_HOME or ANDROID_SDK_ROOT.`
    );
  }
};

const prepareAndroidSdk = (env: NodeJS.ProcessEnv) => {
  const sdkEnvironment = createAndroidSdkEnvironment(
    sanitizeAdbServerEnvironment(env),
    {
      requiredRelativePaths: REQUIRED_ANDROID_TOOL_PATHS,
    }
  );
  const paths = resolveAndroidToolPaths(sdkEnvironment.ANDROID_HOME);
  assertAndroidTools(paths, sdkEnvironment.ANDROID_HOME);
  return { paths, sdkEnvironment };
};

const getAndroidCrashReportDirectory = (
  runtimeDirectory: string,
  pid: number
): string => join(runtimeDirectory, `emulator-crash-${pid}.db`);

const prepareAndroidEnvironment = async (
  env: NodeJS.ProcessEnv,
  owner: AndroidRuntimeLeaseOwner
): Promise<{
  env: NodeJS.ProcessEnv;
  paths: AndroidToolPaths;
}> => {
  const runtimeDirectory = env.HIVE_CELL_RUNTIME_DIR?.trim();
  if (!runtimeDirectory) {
    throw new Error(
      "HIVE_CELL_RUNTIME_DIR is required for the Hive Android emulator."
    );
  }
  if (!env.HIVE_CELL_ID?.trim()) {
    throw new Error("Hive Android emulation is only available inside a cell.");
  }

  const { paths, sdkEnvironment } = prepareAndroidSdk(env);
  const androidRuntimeDirectory =
    resolveAndroidRuntimeDirectory(sdkEnvironment);
  const policyEnvironment = {
    ...sdkEnvironment,
    ...(androidRuntimeDirectory
      ? { XDG_RUNTIME_DIR: androidRuntimeDirectory }
      : {}),
    ANDROID_AVD: owner.avdName,
    ANDROID_EMULATOR_GRPC_PORT: String(owner.grpcPort),
    ANDROID_EMULATOR_HEADLESS: "1",
    ANDROID_SERIAL: owner.serial,
    HIVE_ANDROID_ABI: getHiveAndroidAbi(),
  };
  const graphics = resolveAndroidGraphics(policyEnvironment);
  const avdHome = join(runtimeDirectory, "android-avd");
  const avdPath = join(avdHome, `${owner.avdName}.avd`);
  const crashReportDirectory = getAndroidCrashReportDirectory(
    runtimeDirectory,
    process.pid
  );
  const androidEnvironment = {
    ...policyEnvironment,
    ...(graphics.xAuthority ? { XAUTHORITY: graphics.xAuthority } : {}),
    ANDROID_AVD_HOME: avdHome,
    ANDROID_EMU_CRASH_REPORTING_DATABASE: crashReportDirectory,
    HIVE_ANDROID_GPU_MODE: graphics.gpuMode,
  };

  await Promise.all([
    mkdir(avdHome, { recursive: true }),
    mkdir(crashReportDirectory, { recursive: true }),
  ]);
  if (!existsSync(join(avdPath, "config.ini"))) {
    const image = getHiveAndroidSystemImage();
    const result = spawnSync(
      paths.avdManager,
      [
        "create",
        "avd",
        "--force",
        "--name",
        owner.avdName,
        "--package",
        image,
        "--device",
        HIVE_ANDROID_DEVICE_PROFILE,
        "--path",
        avdPath,
      ],
      {
        encoding: "utf8",
        env: androidEnvironment,
        input: "no\n",
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        result.error?.message ||
          result.stderr.trim() ||
          `Could not create the Hive Android AVD. Install ${image} with sdkmanager and try again.`
      );
    }
  }

  return { env: androidEnvironment, paths };
};

const runWhileAndroidDeviceIsPresent = (
  paths: AndroidToolPaths,
  env: NodeJS.ProcessEnv,
  serial: string,
  command: () => void
): boolean => {
  try {
    command();
    return true;
  } catch (error) {
    if (!isAndroidDevicePresent(paths.adb, serial, env)) {
      return false;
    }
    throw error;
  }
};

const stopExpectedEmulator = async (
  paths: AndroidToolPaths,
  env: NodeJS.ProcessEnv,
  owner: Pick<AndroidRuntimeLeaseOwner, "avdName" | "serial">
): Promise<void> => {
  if (!isAndroidDevicePresent(paths.adb, owner.serial, env)) {
    return;
  }
  let avdName = "";
  if (
    !runWhileAndroidDeviceIsPresent(paths, env, owner.serial, () => {
      avdName = getRunningAndroidAvdName(paths.adb, owner.serial, env);
    })
  ) {
    return;
  }
  if (avdName !== owner.avdName) {
    throw new Error(
      `Hive serial ${owner.serial} is used by AVD ${avdName}, expected ${owner.avdName}.`
    );
  }
  if (
    !runWhileAndroidDeviceIsPresent(paths, env, owner.serial, () =>
      stopAndroidEmulator(paths.adb, owner.serial, env)
    )
  ) {
    return;
  }
  await waitForAndroidDeviceToStop(paths.adb, owner.serial, env);
};

export const stopRecordedAndroidProduct = async (
  owner: Pick<
    AndroidRuntimeLeaseOwner,
    "productFingerprint" | "productMarker" | "productPid"
  >
): Promise<void> => {
  const pid = owner.productPid;
  if (!(pid && isProcessGroupRunning(pid))) {
    return;
  }
  if (
    !(
      owner.productMarker &&
      readProcessCommand(pid)?.includes(owner.productMarker) &&
      owner.productFingerprint
    ) ||
    getAndroidProcessFingerprint(pid) !== owner.productFingerprint
  ) {
    throw new Error(
      `Refusing to terminate unverified Android product process group ${pid}.`
    );
  }
  await terminateProcessGroup(pid);
};

const startAdbServer = (
  paths: AndroidToolPaths,
  env: NodeJS.ProcessEnv
): void => {
  const result = spawnSync(paths.adb, ["start-server"], {
    encoding: "utf8",
    env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
        result.stderr.trim() ||
        "Failed to start the Android Debug Bridge server."
    );
  }
};

const hasChildExited = (child: ChildProcess): boolean =>
  child.pid === undefined ||
  child.exitCode !== null ||
  child.signalCode !== null;

type AndroidCleanupTask = {
  label: string;
  run: () => Promise<void>;
};

export const assertAndroidStartupActive = (shuttingDown: boolean): void => {
  if (shuttingDown) {
    throw new Error("Hive Android startup was interrupted.");
  }
};

export const cleanupAndroidEmulator = async (options: {
  isDevicePresent: () => boolean;
  serial?: string;
  stopExpected?: () => Promise<void>;
  terminateProcess?: () => Promise<void>;
}): Promise<void> => {
  let gracefulStopError: unknown;
  try {
    await options.stopExpected?.();
  } catch (error) {
    gracefulStopError = error;
  }
  await options.terminateProcess?.();
  if (options.isDevicePresent()) {
    throw (
      gracefulStopError ??
      new Error(
        `Android emulator ${options.serial ?? "device"} remains connected after cleanup.`
      )
    );
  }
};

export const cleanupAndroidSession = async (
  tasks: AndroidCleanupTask[],
  releaseLease: () => Promise<void>
): Promise<void> => {
  const results = await Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(task.run))
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ error: result.reason, label: tasks[index]?.label ?? "cleanup" }]
      : []
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      const message =
        failure.error instanceof Error
          ? failure.error.message
          : String(failure.error);
      process.stderr.write(
        `Hive Android ${failure.label} cleanup failed: ${message}\n`
      );
    }
    throw new AggregateError(
      failures.map((failure) => failure.error),
      "Hive Android cleanup did not complete; retaining the emulator lease for stale-owner recovery."
    );
  }
  await releaseLease();
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: emulator, guardian, and lease startup must remain one cleanup boundary.
export async function runAndroidEmulator(options: {
  env?: NodeJS.ProcessEnv;
  grpcPort: number;
  productArgv: string[];
}): Promise<number> {
  const [productCommand, ...productArgs] = options.productArgv;
  if (!productCommand) {
    throw new Error("Android emulator requires a trailing product command.");
  }
  const initialEnv = options.env ?? process.env;
  const { paths, sdkEnvironment } = prepareAndroidSdk(initialEnv);
  startAdbServer(paths, sdkEnvironment);
  const cellId = initialEnv.HIVE_CELL_ID?.trim();
  if (!cellId) {
    throw new Error("Hive Android emulation is only available inside a cell.");
  }

  const lease = await acquireAndroidRuntimeLease({
    avdName: resolveHiveAndroidAvdName(cellId),
    cellId,
    grpcPort: options.grpcPort,
    isSerialAvailable: (serial) =>
      !isAndroidDevicePresent(paths.adb, serial, sdkEnvironment),
    recoverStaleOwner: async (owner) => {
      await stopRecordedAndroidProduct(owner);
      await stopExpectedEmulator(paths, sdkEnvironment, owner);
    },
  });
  let env: NodeJS.ProcessEnv;
  try {
    ({ env } = await prepareAndroidEnvironment(initialEnv, lease.owner));
  } catch (error) {
    await lease.release();
    throw error;
  }
  const children: ChildProcess[] = [];
  const childProcessGroup = process.platform !== "win32";
  let emulatorProcess: ChildProcess | undefined;
  let emulatorExit: Promise<number> | undefined;
  let productProcess: ChildProcess | undefined;
  let productExit: Promise<number> | undefined;
  let mayStopEmulator = false;
  let shuttingDown = false;
  const removeSignalHandlers = forwardSignalsToChildren(() => children, {
    onSignal: () => {
      shuttingDown = true;
    },
    processGroup: childProcessGroup,
  });

  try {
    await stopExpectedEmulator(paths, env, lease.owner);
    mayStopEmulator = true;
    assertAndroidStartupActive(shuttingDown);
    const emulatorArgs = buildAndroidEmulatorArgs({
      avdName: lease.owner.avdName,
      consolePort: lease.owner.consolePort,
      gpuMode: env.HIVE_ANDROID_GPU_MODE ?? "auto",
      grpcPort: options.grpcPort,
    });
    process.stdout.write(
      `Starting Android emulator ${lease.owner.avdName} on ${lease.owner.serial}: ${emulatorArgs.join(" ")}\n`
    );
    emulatorProcess = spawn(paths.emulator, emulatorArgs, {
      detached: childProcessGroup,
      env,
      stdio: "inherit",
    });
    children.push(emulatorProcess);
    emulatorExit = waitForChildExit(emulatorProcess);
    await waitForAndroidDevice(paths.adb, lease.owner.serial, env, {
      hasStartupEnded: () =>
        emulatorProcess ? hasChildExited(emulatorProcess) : true,
      timeoutMs: getHiveAndroidDeviceStartTimeoutMs(env),
    });
    const avdName = getRunningAndroidAvdName(
      paths.adb,
      lease.owner.serial,
      env
    );
    if (avdName !== lease.owner.avdName) {
      throw new Error(
        `Hive serial ${lease.owner.serial} started unexpected AVD ${avdName}.`
      );
    }
    assertAndroidStartupActive(shuttingDown);
    const productEnv = await prepareIsolatedAndroidTools({
      avdName: lease.owner.avdName,
      env,
      expectedLeaseToken: lease.owner.token,
      leasePath: lease.leasePath,
      serial: lease.owner.serial,
      toolsDirectoryName: "product-android-sdk",
    });

    const productMarker = `hive-android-product-${randomUUID()}`;
    productProcess = spawn(
      "/bin/sh",
      buildAndroidProductGuardianArgs(productMarker, [
        productCommand,
        ...productArgs,
      ]),
      {
        cwd: process.cwd(),
        detached: childProcessGroup,
        env: productEnv,
        stdio: ["inherit", "inherit", "inherit", "pipe"],
      }
    );
    children.push(productProcess);
    productExit = waitForChildExit(productProcess);
    if (!productProcess.pid) {
      throw new Error("Android product process did not report a pid.");
    }
    await lease.recordProductProcess(productProcess.pid, productMarker);
    const productControl = productProcess.stdio[3];
    if (!(productControl && "write" in productControl)) {
      throw new Error("Android product guardian control pipe is unavailable.");
    }
    productControl.write("start\n");
    const result = await Promise.race([
      productExit.then((code) => ({ code, source: "product" as const })),
      emulatorExit.then((code) => ({ code, source: "emulator" as const })),
    ]);
    if (result.source === "emulator" && result.code === 0) {
      return 1;
    }
    return result.code;
  } finally {
    removeSignalHandlers();
    const cleanupTasks: AndroidCleanupTask[] = [];
    if (productProcess && productExit) {
      const process = productProcess;
      const exit = productExit;
      cleanupTasks.push({
        label: "product process",
        run: () =>
          terminateChild(process, exit, {
            processGroup: childProcessGroup,
          }),
      });
    }
    if (mayStopEmulator || (emulatorProcess && emulatorExit)) {
      const process = emulatorProcess;
      const exit = emulatorExit;
      cleanupTasks.push({
        label: "emulator",
        run: () =>
          cleanupAndroidEmulator({
            serial: lease.owner.serial,
            isDevicePresent: () =>
              isAndroidDevicePresent(paths.adb, lease.owner.serial, env),
            ...(mayStopEmulator
              ? {
                  stopExpected: () =>
                    stopExpectedEmulator(paths, env, lease.owner),
                }
              : {}),
            ...(process && exit
              ? {
                  terminateProcess: () =>
                    terminateChild(process, exit, {
                      processGroup: childProcessGroup,
                    }),
                }
              : {}),
          }),
      });
    }
    await cleanupAndroidSession(cleanupTasks, lease.release);
  }
}
