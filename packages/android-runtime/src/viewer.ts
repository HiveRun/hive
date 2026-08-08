import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, delimiter, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  type GrpcEndpoint,
  grpcEndpointFor,
} from "stream-droid/src/grpc/discovery.ts";
import { createEmulatorClient } from "stream-droid/src/grpc/emulatorClient.ts";

import {
  getRunningAndroidAvdName,
  waitForAndroidDevice,
} from "./android-device";
import {
  defaultAndroidLeasePath,
  isAndroidLeaseOwnerAlive,
  readAndroidLeaseOwner,
} from "./lease";
import {
  createAndroidSdkEnvironment,
  HIVE_ANDROID_AVD_NAME,
  HIVE_ANDROID_DEFAULT_SERIAL,
  resolveAndroidRuntimeDirectory,
} from "./policy";
import {
  signalChild,
  terminateChild,
  waitForChildExit,
  waitForForwardedChild,
} from "./process";

const GRPC_WAIT_TIMEOUT_MS = 30_000;
const GRPC_PROBE_TIMEOUT_MS = 5000;
const GRPC_RETRY_INTERVAL_MS = 250;
const AUDIO_SAMPLE_RATE = "48000";
const EXECUTABLE_MODE = 0o755;
const OWNERSHIP_POLL_INTERVAL_MS = 100;
const noopAsync = (): Promise<void> => Promise.resolve();

export const serviceAudioOutputEnabled = (env: NodeJS.ProcessEnv): boolean =>
  env.HIVE_SERVICE_AUDIO_OUTPUT !== "0";

export const buildAndroidViewerArgs = (
  serial: string,
  port: number
): string[] => [
  "--serial",
  serial,
  "--capture",
  "grpc",
  "--port",
  String(port),
  "--host",
  "127.0.0.1",
  "--headless",
];

const assertViewerPortAvailable = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

const probeAndroidGrpcScreenshot = (endpoint: GrpcEndpoint): Promise<void> =>
  new Promise((resolve, reject) => {
    const client = createEmulatorClient(endpoint.port, endpoint.token);
    let stop: (() => void) | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      stop?.();
      client.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for an emulator screenshot.")),
      GRPC_PROBE_TIMEOUT_MS
    );
    timeout.unref();
    stop = client.streamScreenshot(
      () => finish(),
      (error) => finish(error)
    );
  });

const waitForAndroidGrpc = async (
  serial: string,
  expectedPort: number,
  timeoutMs = GRPC_WAIT_TIMEOUT_MS
): Promise<GrpcEndpoint> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    const endpoint = grpcEndpointFor(serial);
    if (endpoint?.port === expectedPort) {
      try {
        await probeAndroidGrpcScreenshot(endpoint);
        return endpoint;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    } else if (endpoint) {
      lastError = new Error(
        `discovered gRPC port ${endpoint.port}, expected ${expectedPort}`
      );
    }
    await sleep(GRPC_RETRY_INTERVAL_MS);
  }
  throw new Error(
    `Android emulator ${serial} gRPC capture on port ${expectedPort} did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : "."}`
  );
};

const startAndroidAudioPlayback = (
  endpoint: GrpcEndpoint,
  env: NodeJS.ProcessEnv
): (() => Promise<void>) => {
  if (process.platform !== "linux") {
    return noopAsync;
  }
  const userId = process.getuid?.();
  const runtimeDirectory =
    env.XDG_RUNTIME_DIR?.trim() ||
    (userId === undefined ? undefined : `/run/user/${userId}`);
  if (!runtimeDirectory) {
    process.stderr.write(
      "Hive Android audio is unavailable: no runtime directory.\n"
    );
    return noopAsync;
  }
  const audioEnvironment = {
    ...env,
    XDG_RUNTIME_DIR: runtimeDirectory,
  };
  const pwCatCheck = spawnSync("pw-cat", ["--version"], {
    encoding: "utf8",
    env: audioEnvironment,
  });
  if (pwCatCheck.error || pwCatCheck.status !== 0) {
    process.stderr.write(
      `Hive Android audio is unavailable: ${pwCatCheck.error?.message || pwCatCheck.stderr?.trim() || "pw-cat is not available."}\n`
    );
    return noopAsync;
  }

  const client = createEmulatorClient(endpoint.port, endpoint.token);
  const playback = spawn(
    "pw-cat",
    [
      "--playback",
      "--raw",
      "--format",
      "s16",
      "--rate",
      AUDIO_SAMPLE_RATE,
      "--channels",
      "2",
      "--latency",
      "40ms",
      "-",
    ],
    { env: audioEnvironment, stdio: ["pipe", "ignore", "inherit"] }
  );
  const playbackExit = waitForChildExit(playback);
  let stopPromise: Promise<void> | undefined;
  let output: ReturnType<typeof client.streamAudio> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      output?.stop();
      playback.stdin?.end();
      client.close();
      await terminateChild(playback, playbackExit, {
        shutdownTimeoutMs: 5000,
      });
    })();
    return stopPromise;
  };
  const reportError = (error: Error): void => {
    process.stderr.write(
      `Hive Android audio bridge failed: ${error.message}\n`
    );
  };
  const stopAfterError = (): void => {
    stop().catch(reportError);
  };
  playback.once("error", (error) => {
    reportError(error);
    stopAfterError();
  });
  playback.once("exit", (code, signal) => {
    if (!stopPromise) {
      reportError(
        new Error(`pw-cat exited (${signal || `code ${code ?? "unknown"}`}).`)
      );
      stopAfterError();
    }
  });
  output = client.streamAudio(
    (pcm) => playback.stdin?.write(pcm) ?? false,
    (error) => {
      reportError(error);
      stopAfterError();
    }
  );
  playback.stdin?.on("drain", () => output?.resume());
  return stop;
};

const quoteShellValue = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

export const prepareIsolatedAndroidTools = async (
  env: NodeJS.ProcessEnv,
  serial: string,
  expectedLeaseOwner: string,
  leasePath = defaultAndroidLeasePath
): Promise<NodeJS.ProcessEnv> => {
  const runtimeDirectory = env.HIVE_CELL_RUNTIME_DIR?.trim();
  if (!runtimeDirectory) {
    throw new Error(
      "HIVE_CELL_RUNTIME_DIR is required for the Hive Android viewer."
    );
  }
  const realSdkDirectory = env.ANDROID_HOME;
  if (!realSdkDirectory) {
    throw new Error("ANDROID_HOME is required for the Hive Android viewer.");
  }

  const sdkDirectory = join(runtimeDirectory, "viewer-android-sdk");
  const platformToolsDirectory = join(sdkDirectory, "platform-tools");
  const emulatorDirectory = join(sdkDirectory, "emulator");
  const adbWrapperPath = join(platformToolsDirectory, "adb");
  const emulatorWrapperPath = join(emulatorDirectory, "emulator");
  const realAdbPath = join(realSdkDirectory, "platform-tools", "adb");
  const realEmulatorPath = join(realSdkDirectory, "emulator", "emulator");

  await Promise.all([
    mkdir(platformToolsDirectory, { recursive: true }),
    mkdir(emulatorDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      adbWrapperPath,
      `#!/bin/sh
real_adb=${quoteShellValue(realAdbPath)}
target=${quoteShellValue(serial)}
target_avd=${quoteShellValue(HIVE_ANDROID_AVD_NAME)}
lease_owner_file=${quoteShellValue(join(leasePath, "owner.json"))}
expected_lease_owner=${quoteShellValue(expectedLeaseOwner)}
assert_lease_owner() {
  actual_lease_owner=$(cat "$lease_owner_file" 2>/dev/null) || actual_lease_owner=''
  if [ "$actual_lease_owner" != "$expected_lease_owner" ]; then
    printf 'Hive Android viewer no longer owns %s\\n' "$target" >&2
    exit 1
  fi
}
assert_target_avd() {
  running_avd=$("$real_adb" -s "$target" emu avd name 2>/dev/null | tr -d '\\r' | sed -n '1p')
  if [ "$running_avd" != "$target_avd" ]; then
    printf 'Hive Android viewer expected AVD %s on %s\\n' "$target_avd" "$target" >&2
    exit 1
  fi
}
assert_lease_owner
if [ "$1" = "devices" ]; then
  output=$("$real_adb" "$@") || exit $?
  printf 'List of devices attached\\n'
  case "$output" in
    *"$target"*)
      assert_target_avd
      printf '%s\\n' "$output" | while IFS= read -r line; do
        case "$line" in
          "$target"*) printf '%s\\n' "$line" ;;
        esac
      done
      ;;
  esac
  exit 0
fi
if [ "$1" = "-s" ]; then
  if [ "$2" != "$target" ]; then
    printf 'Hive Android viewer only permits %s\\n' "$target" >&2
    exit 1
  fi
  assert_target_avd
  exec "$real_adb" "$@"
fi
printf 'Hive Android viewer requires explicitly targeted adb commands\\n' >&2
exit 1
`
    ),
    writeFile(
      emulatorWrapperPath,
      `#!/bin/sh
real_emulator=${quoteShellValue(realEmulatorPath)}
target_avd=${quoteShellValue(HIVE_ANDROID_AVD_NAME)}
target_port=${quoteShellValue(serial.slice("emulator-".length))}
lease_owner_file=${quoteShellValue(join(leasePath, "owner.json"))}
expected_lease_owner=${quoteShellValue(expectedLeaseOwner)}
actual_lease_owner=$(cat "$lease_owner_file" 2>/dev/null) || actual_lease_owner=''
if [ "$actual_lease_owner" != "$expected_lease_owner" ]; then
  printf 'Hive Android viewer no longer owns %s\\n' "$target_avd" >&2
  exit 1
fi
if [ "$1" = "-list-avds" ]; then
  printf '%s\\n' "$target_avd"
  exit 0
fi
if [ "$1" = "-help" ] || [ "$1" = "-accel-check" ]; then
  exec "$real_emulator" "$@"
fi
previous=''
for argument in "$@"; do
  if [ "$previous" = "-avd" ] && [ "$argument" != "$target_avd" ]; then
    printf 'Hive Android viewer only permits AVD %s\\n' "$target_avd" >&2
    exit 1
  fi
  if [ "$previous" = "-port" ] && [ "$argument" != "$target_port" ]; then
    printf 'Hive Android viewer only permits emulator port %s\\n' "$target_port" >&2
    exit 1
  fi
  previous="$argument"
done
exec "$real_emulator" "$@" -port "$target_port" -no-window
`
    ),
  ]);
  await Promise.all([
    chmod(adbWrapperPath, EXECUTABLE_MODE),
    chmod(emulatorWrapperPath, EXECUTABLE_MODE),
  ]);

  return {
    ...env,
    ANDROID_AVD_HOME: join(runtimeDirectory, "android-avd"),
    ANDROID_HOME: sdkDirectory,
    ANDROID_SDK_ROOT: sdkDirectory,
    PATH: [platformToolsDirectory, emulatorDirectory, env.PATH ?? ""].join(
      delimiter
    ),
  };
};

type ViewerRuntimeLayoutOptions = {
  execPath?: string;
  isCompiledRuntime?: boolean;
  sourceExecutablePath?: string;
};

type ViewerRuntimeLayout = {
  executable: string;
  protoPath: string;
  publicDirectory: string;
};

const resolveModulePath = (specifier: string): string => {
  const resolved = import.meta.resolve(specifier);
  return resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved;
};

export const resolveViewerRuntimeLayout = (
  options: ViewerRuntimeLayoutOptions = {}
): ViewerRuntimeLayout => {
  const execPath = options.execPath ?? process.execPath;
  const compiled =
    options.isCompiledRuntime ??
    !basename(execPath).toLowerCase().startsWith("bun");
  if (compiled) {
    const releaseDirectory = dirname(execPath);
    const assetsDirectory = join(
      releaseDirectory,
      "android-runtime",
      "stream-droid"
    );
    return {
      executable: join(
        releaseDirectory,
        process.platform === "win32"
          ? "hive-android-viewer-server.exe"
          : "hive-android-viewer-server"
      ),
      protoPath: join(assetsDirectory, "emulator_controller.proto"),
      publicDirectory: join(assetsDirectory, "public"),
    };
  }

  const executable =
    options.sourceExecutablePath ??
    resolveModulePath("stream-droid/bin/stream-droid.mjs");
  const packageDirectory = dirname(dirname(executable));
  return {
    executable,
    protoPath: join(
      packageDirectory,
      "src",
      "grpc",
      "emulator_controller.proto"
    ),
    publicDirectory: join(packageDirectory, "public"),
  };
};

const assertViewerRuntimeLayout = (layout: ViewerRuntimeLayout): void => {
  for (const [label, path] of Object.entries(layout)) {
    if (!existsSync(path)) {
      throw new Error(`Hive Android viewer ${label} is missing at ${path}.`);
    }
  }
};

export const runAndroidViewer = async (options: {
  env?: NodeJS.ProcessEnv;
  grpcPort: number;
  port: number;
}): Promise<number> => {
  const sdkEnvironment = createAndroidSdkEnvironment(
    options.env ?? process.env,
    {
      requiredRelativePaths: ["platform-tools/adb", "emulator/emulator"],
    }
  );
  const runtimeDirectory = resolveAndroidRuntimeDirectory(sdkEnvironment);
  const androidEnv: typeof sdkEnvironment = {
    ...sdkEnvironment,
    ...(runtimeDirectory ? { XDG_RUNTIME_DIR: runtimeDirectory } : {}),
  };
  if (runtimeDirectory) {
    process.env.XDG_RUNTIME_DIR = runtimeDirectory;
  }
  const serial =
    androidEnv.ANDROID_SERIAL?.trim() || HIVE_ANDROID_DEFAULT_SERIAL;
  if (serial !== HIVE_ANDROID_DEFAULT_SERIAL) {
    throw new Error(
      `Hive Android viewer requires reserved serial ${HIVE_ANDROID_DEFAULT_SERIAL}, got ${serial}.`
    );
  }
  const cellId = androidEnv.HIVE_CELL_ID?.trim();
  if (!cellId) {
    throw new Error("Hive Android viewer is only available inside a cell.");
  }
  const realAdbPath = join(androidEnv.ANDROID_HOME, "platform-tools", "adb");
  await waitForAndroidDevice(realAdbPath, serial, androidEnv);
  const leaseOwner = await readAndroidLeaseOwner();
  if (!leaseOwner || leaseOwner.cellId !== cellId) {
    throw new Error(
      `Hive Android viewer expected cell ${cellId} to own ${serial}.`
    );
  }
  const runningAvdName = getRunningAndroidAvdName(
    realAdbPath,
    serial,
    androidEnv
  );
  if (runningAvdName !== HIVE_ANDROID_AVD_NAME) {
    throw new Error(
      `Hive Android viewer expected AVD ${HIVE_ANDROID_AVD_NAME} on ${serial}, found ${runningAvdName}.`
    );
  }
  await assertViewerPortAvailable(options.port);
  const viewerLayout = resolveViewerRuntimeLayout();
  assertViewerRuntimeLayout(viewerLayout);
  process.env.HIVE_ANDROID_EMULATOR_PROTO_PATH = viewerLayout.protoPath;
  const grpcEndpoint = await waitForAndroidGrpc(serial, options.grpcPort);
  const isolatedAndroidEnv = await prepareIsolatedAndroidTools(
    androidEnv,
    serial,
    JSON.stringify(leaseOwner)
  );
  const leaseToken = leaseOwner.token;
  const viewerEnvironment = {
    ...isolatedAndroidEnv,
    HIVE_ANDROID_EMULATOR_PROTO_PATH: viewerLayout.protoPath,
    HIVE_ANDROID_STREAM_DROID_STRICT_PORT: "1",
    HIVE_ANDROID_STREAM_DROID_PUBLIC_DIR: viewerLayout.publicDirectory,
  };

  const childProcessGroup = process.platform !== "win32";
  let child: ChildProcess | undefined;
  let stopAudioPlayback: (() => Promise<void>) | undefined;
  let ownershipChanged = false;
  const stopForOwnershipChange = async (): Promise<void> => {
    try {
      const currentOwner = await readAndroidLeaseOwner();
      ownershipChanged =
        !currentOwner ||
        currentOwner.token !== leaseToken ||
        !isAndroidLeaseOwnerAlive(currentOwner);
    } catch {
      ownershipChanged = true;
    }
    if (ownershipChanged && child) {
      signalChild(child, "SIGTERM", childProcessGroup);
    }
  };
  const leaseWatcher = watch(
    defaultAndroidLeasePath,
    { persistent: false },
    () => stopForOwnershipChange()
  );
  leaseWatcher.on("error", () => {
    ownershipChanged = true;
    if (child) {
      signalChild(child, "SIGTERM", childProcessGroup);
    }
  });
  const ownershipInterval = setInterval(
    () => stopForOwnershipChange(),
    OWNERSHIP_POLL_INTERVAL_MS
  );
  ownershipInterval.unref();

  try {
    await stopForOwnershipChange();
    if (ownershipChanged) {
      throw new Error(`Hive Android viewer lost ownership of ${serial}.`);
    }
    if (serviceAudioOutputEnabled(androidEnv)) {
      stopAudioPlayback = startAndroidAudioPlayback(
        grpcEndpoint,
        isolatedAndroidEnv
      );
    }
    child = spawn(
      viewerLayout.executable,
      buildAndroidViewerArgs(serial, options.port),
      {
        cwd: dirname(viewerLayout.executable),
        detached: childProcessGroup,
        env: viewerEnvironment,
        stdio: "inherit",
      }
    );
    if (ownershipChanged) {
      signalChild(child, "SIGTERM", childProcessGroup);
    }
    return await waitForForwardedChild(child, {
      processGroup: childProcessGroup,
    });
  } finally {
    await stopAudioPlayback?.();
    clearInterval(ownershipInterval);
    leaseWatcher.close();
  }
};
