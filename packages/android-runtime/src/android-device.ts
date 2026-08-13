import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const LINE_BREAK_PATTERN = /\r?\n/;
const WHITESPACE_PATTERN = /\s+/;
const ADB_COMMAND_TIMEOUT_MS = 5000;
const ADB_EMULATOR_COMMAND_TIMEOUT_MS = 1000;
const DEVICE_POLL_INTERVAL_MS = 1000;
const DEFAULT_DEVICE_WAIT_TIMEOUT_MS = 300_000;
const MILLISECONDS_PER_SECOND = 1000;

const runAdb = (
  adbPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout = ADB_COMMAND_TIMEOUT_MS
) =>
  spawnSync(adbPath, args, {
    encoding: "utf8",
    env,
    timeout,
  });

const readAndroidDevicesOutput = (
  adbPath: string,
  env: NodeJS.ProcessEnv,
  timeout = ADB_COMMAND_TIMEOUT_MS,
  failureMessage = "adb devices failed"
): string => {
  const result = runAdb(adbPath, ["devices"], env, timeout);
  if (result.error) {
    throw new Error(`${failureMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || failureMessage);
  }
  return result.stdout;
};

export const parseConnectedAndroidDevices = (output: string): string[] =>
  output
    .split(LINE_BREAK_PATTERN)
    .slice(1)
    .map((line) => line.trim().split(WHITESPACE_PATTERN))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial)
    .filter((serial): serial is string => Boolean(serial));

export const parseAttachedAndroidDevices = (output: string): string[] =>
  output
    .split(LINE_BREAK_PATTERN)
    .slice(1)
    .map((line) => line.trim().split(WHITESPACE_PATTERN)[0])
    .filter((serial): serial is string => Boolean(serial));

const getConnectedAndroidDevices = (
  adbPath: string,
  env: NodeJS.ProcessEnv
): string[] =>
  parseConnectedAndroidDevices(readAndroidDevicesOutput(adbPath, env));

export const isAndroidDeviceReady = (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv
): boolean => {
  if (!getConnectedAndroidDevices(adbPath, env).includes(serial)) {
    return false;
  }
  const result = runAdb(
    adbPath,
    ["-s", serial, "shell", "getprop", "sys.boot_completed"],
    env
  );
  return !result.error && result.status === 0 && result.stdout.trim() === "1";
};

export const isAndroidDevicePresent = (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv,
  timeout = ADB_COMMAND_TIMEOUT_MS
): boolean => {
  const failureMessage = `Could not determine whether Android device ${serial} is present`;
  return parseAttachedAndroidDevices(
    readAndroidDevicesOutput(adbPath, env, timeout, failureMessage)
  ).includes(serial);
};

export const getRunningAndroidAvdName = (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv
): string => {
  const result = runAdb(
    adbPath,
    ["-s", serial, "emu", "avd", "name"],
    env,
    ADB_EMULATOR_COMMAND_TIMEOUT_MS
  );
  const avdName = result.stdout
    .split(LINE_BREAK_PATTERN)
    .map((line) => line.trim())
    .find((line) => line && line !== "OK");
  if (result.error || result.status !== 0 || !avdName) {
    throw new Error(
      result.error?.message ||
        result.stderr.trim() ||
        `Could not identify Android emulator ${serial}.`
    );
  }
  return avdName;
};

export const stopAndroidEmulator = (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv
): void => {
  const result = runAdb(
    adbPath,
    ["-s", serial, "emu", "kill"],
    env,
    ADB_EMULATOR_COMMAND_TIMEOUT_MS
  );
  if (result.error || result.status !== 0) {
    const message =
      result.error?.message ||
      result.stderr.trim() ||
      `Could not stop Android emulator ${serial}.`;
    throw new Error(message);
  }
};

export const waitForAndroidDeviceToStop = async (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAndroidDevicePresent(adbPath, serial, env)) {
      return;
    }
    await sleep(DEVICE_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Android emulator ${serial} did not stop within ${Math.round(timeoutMs / MILLISECONDS_PER_SECOND)} seconds.`
  );
};

export const waitForAndroidDevice = async (
  adbPath: string,
  serial: string,
  env: NodeJS.ProcessEnv,
  options: {
    hasStartupEnded?: () => boolean;
    timeoutMs?: number;
  } = {}
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEVICE_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAndroidDeviceReady(adbPath, serial, env)) {
      return;
    }
    if (options.hasStartupEnded?.()) {
      throw new Error(
        `Android emulator process exited before ${serial} appeared.`
      );
    }
    await sleep(DEVICE_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Android emulator ${serial} did not finish booting within ${timeoutMs}ms.`
  );
};
