import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  getAttachedAndroidDevices,
  getRunningAndroidAvdName,
  isAndroidDevicePresent,
  stopAndroidEmulator,
  waitForAndroidDevice,
  waitForAndroidDeviceToStop,
} from "./android-device";
import { acquireAndroidRuntimeLease } from "./lease";
import {
  buildAndroidEmulatorArgs,
  createAndroidSdkEnvironment,
  getHiveAndroidAbi,
  getHiveAndroidDeviceStartTimeoutMs,
  getHiveAndroidSystemImage,
  HIVE_ANDROID_AVD_NAME,
  HIVE_ANDROID_DEFAULT_SERIAL,
  HIVE_ANDROID_DEVICE_PROFILE,
  resolveAndroidGraphics,
  resolveAndroidRuntimeDirectory,
} from "./policy";
import {
  forwardSignalsToChildren,
  terminateChild,
  waitForChildExit,
} from "./process";

type AndroidToolPaths = {
  adb: string;
  avdManager: string;
  emulator: string;
};

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

const getAndroidCrashReportDirectory = (
  runtimeDirectory: string,
  pid: number
): string => join(runtimeDirectory, `emulator-crash-${pid}.db`);

const prepareAndroidEnvironment = async (
  env: NodeJS.ProcessEnv,
  grpcPort: number
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

  const sdkEnvironment = createAndroidSdkEnvironment(env, {
    requiredRelativePaths: [
      "platform-tools/adb",
      "emulator/emulator",
      "cmdline-tools/latest/bin/avdmanager",
    ],
  });
  const paths = resolveAndroidToolPaths(sdkEnvironment.ANDROID_HOME);
  assertAndroidTools(paths, sdkEnvironment.ANDROID_HOME);
  const androidRuntimeDirectory =
    resolveAndroidRuntimeDirectory(sdkEnvironment);
  const policyEnvironment = {
    ...sdkEnvironment,
    ...(androidRuntimeDirectory
      ? { XDG_RUNTIME_DIR: androidRuntimeDirectory }
      : {}),
    ANDROID_AVD: HIVE_ANDROID_AVD_NAME,
    ANDROID_EMULATOR_GRPC_PORT: String(grpcPort),
    ANDROID_EMULATOR_HEADLESS: "1",
    ANDROID_SERIAL: HIVE_ANDROID_DEFAULT_SERIAL,
    HIVE_ANDROID_ABI: getHiveAndroidAbi(),
  };
  const graphics = resolveAndroidGraphics(policyEnvironment);
  const avdHome = join(runtimeDirectory, "android-avd");
  const avdPath = join(avdHome, `${HIVE_ANDROID_AVD_NAME}.avd`);
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
        HIVE_ANDROID_AVD_NAME,
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
  command: () => void
): boolean => {
  try {
    command();
    return true;
  } catch (error) {
    if (!isAndroidDevicePresent(paths.adb, HIVE_ANDROID_DEFAULT_SERIAL, env)) {
      return false;
    }
    throw error;
  }
};

const stopExpectedEmulator = async (
  paths: AndroidToolPaths,
  env: NodeJS.ProcessEnv
): Promise<void> => {
  if (!isAndroidDevicePresent(paths.adb, HIVE_ANDROID_DEFAULT_SERIAL, env)) {
    return;
  }
  let avdName = "";
  if (
    !runWhileAndroidDeviceIsPresent(paths, env, () => {
      avdName = getRunningAndroidAvdName(
        paths.adb,
        HIVE_ANDROID_DEFAULT_SERIAL,
        env
      );
    })
  ) {
    return;
  }
  if (avdName !== HIVE_ANDROID_AVD_NAME) {
    throw new Error(
      `Reserved Hive serial ${HIVE_ANDROID_DEFAULT_SERIAL} is used by AVD ${avdName}. Stop it before starting this cell.`
    );
  }
  if (
    !runWhileAndroidDeviceIsPresent(paths, env, () =>
      stopAndroidEmulator(paths.adb, HIVE_ANDROID_DEFAULT_SERIAL, env)
    )
  ) {
    return;
  }
  await waitForAndroidDeviceToStop(paths.adb, HIVE_ANDROID_DEFAULT_SERIAL, env);
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
        `Android emulator ${HIVE_ANDROID_DEFAULT_SERIAL} remains connected after cleanup.`
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

export async function runAndroidEmulator(options: {
  env?: NodeJS.ProcessEnv;
  grpcPort: number;
  productArgv: string[];
}): Promise<number> {
  const [productCommand, ...productArgs] = options.productArgv;
  if (!productCommand) {
    throw new Error("Android emulator requires a trailing product command.");
  }
  const { env, paths } = await prepareAndroidEnvironment(
    options.env ?? process.env,
    options.grpcPort
  );
  startAdbServer(paths, env);
  const cellId = env.HIVE_CELL_ID?.trim();
  if (!cellId) {
    throw new Error("Hive Android emulation is only available inside a cell.");
  }

  const releaseLease = await acquireAndroidRuntimeLease({
    cellId,
    recoverStaleOwner: () => stopExpectedEmulator(paths, env),
  });
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
    await stopExpectedEmulator(paths, env);
    mayStopEmulator = true;
    assertAndroidStartupActive(shuttingDown);
    const connectedSerials = getAttachedAndroidDevices(paths.adb, env);
    const emulatorArgs = buildAndroidEmulatorArgs({
      connectedSerials,
      gpuMode: env.HIVE_ANDROID_GPU_MODE ?? "auto",
      grpcPort: options.grpcPort,
    });
    process.stdout.write(
      `Starting Android emulator ${HIVE_ANDROID_AVD_NAME}: ${emulatorArgs.join(" ")}\n`
    );
    emulatorProcess = spawn(paths.emulator, emulatorArgs, {
      detached: childProcessGroup,
      env,
      stdio: "inherit",
    });
    children.push(emulatorProcess);
    emulatorExit = waitForChildExit(emulatorProcess);
    await waitForAndroidDevice(paths.adb, HIVE_ANDROID_DEFAULT_SERIAL, env, {
      hasStartupEnded: () =>
        emulatorProcess ? hasChildExited(emulatorProcess) : true,
      timeoutMs: getHiveAndroidDeviceStartTimeoutMs(env),
    });
    const avdName = getRunningAndroidAvdName(
      paths.adb,
      HIVE_ANDROID_DEFAULT_SERIAL,
      env
    );
    if (avdName !== HIVE_ANDROID_AVD_NAME) {
      throw new Error(
        `Reserved Hive serial ${HIVE_ANDROID_DEFAULT_SERIAL} started unexpected AVD ${avdName}.`
      );
    }
    assertAndroidStartupActive(shuttingDown);

    productProcess = spawn(productCommand, productArgs, {
      cwd: process.cwd(),
      detached: childProcessGroup,
      env,
      stdio: "inherit",
    });
    children.push(productProcess);
    productExit = waitForChildExit(productProcess);
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
            isDevicePresent: () =>
              isAndroidDevicePresent(
                paths.adb,
                HIVE_ANDROID_DEFAULT_SERIAL,
                env
              ),
            ...(mayStopEmulator
              ? { stopExpected: () => stopExpectedEmulator(paths, env) }
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
    await cleanupAndroidSession(cleanupTasks, releaseLease);
  }
}
