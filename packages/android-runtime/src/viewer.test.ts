import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createEmulatorClient } from "stream-droid/src/grpc/emulatorClient.ts";
import { describe, expect, it } from "vitest";

import { parseConnectedAndroidDevices } from "./android-device";
import { sanitizeAdbServerEnvironment } from "./policy";
import {
  buildAndroidViewerArgs,
  prepareIsolatedAndroidTools,
  resolveViewerRuntimeLayout,
  serviceAudioOutputEnabled,
  waitForCellAndroidLease,
} from "./viewer";

const EXECUTABLE_MODE = 0o755;
const GRPC_TEST_PORT = 8554;
const VIEWER_PORT = 41_000;
const VIEWER_START_TIMEOUT_MS = 3000;
const VIEWER_TEST_TIMEOUT_MS = 10_000;
const VIEWER_LEASE_TIMEOUT_MS = 2000;

describe("Android viewer runtime", () => {
  it("removes alternate ADB routing from Hive-owned viewer commands", () => {
    const original = {
      ADB_SERVER_SOCKET: "tcp:other-host:5038",
      ANDROID_ADB_SERVER_ADDRESS: "other-host",
      ANDROID_ADB_SERVER_PORT: "5038",
      CUSTOM_VALUE: "preserved",
    };

    const environment = sanitizeAdbServerEnvironment(original);

    expect(environment.ADB_SERVER_SOCKET).toBeUndefined();
    expect(environment.ANDROID_ADB_SERVER_ADDRESS).toBeUndefined();
    expect(environment.ANDROID_ADB_SERVER_PORT).toBeUndefined();
    expect(environment.CUSTOM_VALUE).toBe("preserved");
    expect(original.ADB_SERVER_SOCKET).toBe("tcp:other-host:5038");
  });

  it("parses only ready devices and builds a loopback viewer command", () => {
    expect(
      parseConnectedAndroidDevices(
        "List of devices attached\nemulator-5580\tdevice\nemulator-5556\toffline\nphone\tunauthorized\n"
      )
    ).toEqual(["emulator-5580"]);
    expect(buildAndroidViewerArgs("emulator-5580", VIEWER_PORT)).toEqual([
      "--serial",
      "emulator-5580",
      "--capture",
      "grpc",
      "--port",
      "41000",
      "--host",
      "127.0.0.1",
      "--headless",
    ]);
  });

  it("enables service audio output by default and honors an explicit disable", () => {
    expect(serviceAudioOutputEnabled({})).toBe(true);
    expect(serviceAudioOutputEnabled({ HIVE_SERVICE_AUDIO_OUTPUT: "1" })).toBe(
      true
    );
    expect(serviceAudioOutputEnabled({ HIVE_SERVICE_AUDIO_OUTPUT: "0" })).toBe(
      false
    );
  });

  it("waits for a concurrently starting emulator to publish its slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "hive-android-viewer-lease-"));
    const leasePath = join(root, "slots", "5554");
    const pendingLease = waitForCellAndroidLease(
      "cell-a",
      VIEWER_LEASE_TIMEOUT_MS,
      root
    );
    await mkdir(leasePath, { recursive: true });
    await writeFile(
      join(leasePath, "owner.json"),
      JSON.stringify({
        avdName: "Hive_Pixel_7_cell-a",
        cellId: "cell-a",
        consolePort: 5554,
        grpcPort: 8558,
        pid: process.pid,
        serial: "emulator-5554",
        token: "token-a",
      })
    );
    try {
      expect((await pendingLease).owner.serial).toBe("emulator-5554");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("resolves source and compiled viewer assets next to their runtimes", () => {
    expect(
      resolveViewerRuntimeLayout({
        execPath: "/workspace/node_modules/.bin/bun",
        isCompiledRuntime: false,
        sourceExecutablePath:
          "/workspace/node_modules/stream-droid/bin/stream-droid.mjs",
      })
    ).toEqual({
      executable: "/workspace/node_modules/stream-droid/bin/stream-droid.mjs",
      protoPath:
        "/workspace/node_modules/stream-droid/src/grpc/emulator_controller.proto",
      publicDirectory: "/workspace/node_modules/stream-droid/public",
    });
    expect(
      resolveViewerRuntimeLayout({
        execPath: "/opt/hive/current/hive",
        isCompiledRuntime: true,
      })
    ).toEqual({
      executable: "/opt/hive/current/hive-android-viewer-server",
      protoPath:
        "/opt/hive/current/android-runtime/stream-droid/emulator_controller.proto",
      publicDirectory: "/opt/hive/current/android-runtime/stream-droid/public",
    });
  });

  it("resolves the emulator proto when the client is created", () => {
    const originalProtoPath = process.env.HIVE_ANDROID_EMULATOR_PROTO_PATH;
    try {
      process.env.HIVE_ANDROID_EMULATOR_PROTO_PATH =
        "/missing/hive-android-emulator.proto";
      expect(() => createEmulatorClient(GRPC_TEST_PORT, "token")).toThrow();

      process.env.HIVE_ANDROID_EMULATOR_PROTO_PATH = resolveViewerRuntimeLayout(
        { isCompiledRuntime: false }
      ).protoPath;
      const client = createEmulatorClient(GRPC_TEST_PORT, "token");
      client.close();
    } finally {
      process.env.HIVE_ANDROID_EMULATOR_PROTO_PATH = originalProtoPath;
    }
  });

  it("guards adb and emulator wrappers to the leased Hive device", async () => {
    const root = await mkdtemp(join(tmpdir(), "hive-android-tools-test-"));
    const runtimeDirectory = join(root, "runtime");
    const sdkDirectory = join(root, "sdk");
    const leasePath = join(root, "lease");
    const adbLogPath = join(root, "adb.log");
    const emulatorLogPath = join(root, "emulator.log");
    const androidJarPath = join(
      sdkDirectory,
      "platforms",
      "android-35",
      "android.jar"
    );
    const owner = JSON.stringify({
      avdName: "Hive_Pixel_7",
      cellId: "cell-a",
      consolePort: 5556,
      grpcPort: 8558,
      pid: process.pid,
      serial: "emulator-5556",
      token: "token-a",
    });
    const realAdbPath = join(sdkDirectory, "platform-tools", "adb");
    const realEmulatorPath = join(sdkDirectory, "emulator", "emulator");
    await Promise.all([
      mkdir(dirname(realAdbPath), { recursive: true }),
      mkdir(dirname(realEmulatorPath), { recursive: true }),
      mkdir(dirname(androidJarPath), { recursive: true }),
      mkdir(leasePath, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        realAdbPath,
        `#!/bin/sh
if [ "$*" = "devices" ] || [ "$*" = "-s emulator-5556 devices" ] || [ "$*" = "--exit-on-write-error devices" ]; then
  printf 'List of devices attached\\nemulator-5554\\tdevice\\nemulator-5556\\tdevice\\n'
elif [ "$*" = "-s emulator-5556 emu avd name" ]; then
  printf 'Hive_Pixel_7\\nOK\\n'
else
  printf '%s|%s|%s|%s\\n' "$*" "\${ADB_SERVER_SOCKET-unset}" "\${ANDROID_ADB_SERVER_ADDRESS-unset}" "\${ANDROID_ADB_SERVER_PORT-unset}" >> "$FAKE_ADB_LOG"
fi
`
      ),
      writeFile(
        realEmulatorPath,
        `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_EMULATOR_LOG"
`
      ),
      writeFile(join(leasePath, "owner.json"), owner),
      writeFile(join(leasePath, "token"), "token-a"),
      writeFile(androidJarPath, "android-platform"),
    ]);
    await Promise.all([
      chmod(realAdbPath, EXECUTABLE_MODE),
      chmod(realEmulatorPath, EXECUTABLE_MODE),
    ]);

    try {
      const isolatedEnv = await prepareIsolatedAndroidTools({
        avdName: "Hive_Pixel_7",
        env: {
          ADB_SERVER_SOCKET: "tcp:other-host:5038",
          ANDROID_ADB_SERVER_ADDRESS: "other-host",
          ANDROID_ADB_SERVER_PORT: "5038",
          ANDROID_HOME: sdkDirectory,
          FAKE_ADB_LOG: adbLogPath,
          FAKE_EMULATOR_LOG: emulatorLogPath,
          HIVE_CELL_RUNTIME_DIR: runtimeDirectory,
          PATH: [
            dirname(realAdbPath),
            `${dirname(realAdbPath)}/`,
            join(dirname(realAdbPath), "..", "platform-tools"),
            dirname(realEmulatorPath),
            `${dirname(realEmulatorPath)}/`,
            process.env.PATH ?? "",
          ].join(delimiter),
        },
        expectedLeaseToken: "token-a",
        leasePath,
        serial: "emulator-5556",
        toolsDirectoryName: "viewer-android-sdk",
      });
      const adbPath = join(
        runtimeDirectory,
        "viewer-android-sdk",
        "platform-tools",
        "adb"
      );
      const emulatorPath = join(
        runtimeDirectory,
        "viewer-android-sdk",
        "emulator",
        "emulator"
      );

      const devices = spawnSync(adbPath, ["devices"], {
        encoding: "utf8",
        env: isolatedEnv,
      });
      expect(devices.status).toBe(0);
      expect(devices.stdout).toContain("emulator-5556");
      expect(devices.stdout).not.toContain("emulator-5554");
      expect(
        await readFile(
          join(
            isolatedEnv.ANDROID_HOME ?? "",
            "platforms",
            "android-35",
            "android.jar"
          ),
          "utf8"
        )
      ).toBe("android-platform");
      expect(spawnSync(adbPath, ["shell"], { env: isolatedEnv }).status).toBe(
        0
      );
      expect(
        spawnSync(adbPath, ["-s", "emulator-5554", "shell"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
      expect(
        spawnSync(adbPath, ["-s", "emulator-5556", "shell"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      expect(
        spawnSync(adbPath, ["shell", "-s", "emulator-5554"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      expect(
        spawnSync(
          adbPath,
          [
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            "calibrate://dev-client",
          ],
          { env: isolatedEnv }
        ).status
      ).toBe(0);
      expect(
        spawnSync(adbPath, ["-t", "2", "shell"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
      for (const option of [
        "-s127.0.0.1:5555",
        "-t2",
        "-Hhost",
        "-P5037",
        "-Ltcp:5037",
      ]) {
        expect(
          spawnSync(adbPath, [option, "shell"], { env: isolatedEnv }).status
        ).toBe(1);
      }
      expect(await readFile(adbLogPath, "utf8")).toContain(
        "-s emulator-5556 shell|unset|unset|unset"
      );
      expect(
        spawnSync(adbPath, ["reverse", "tcp:3000", "tcp:3000"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      expect(await readFile(adbLogPath, "utf8")).toContain(
        "-s emulator-5556 reverse tcp:3000 tcp:3000|unset|unset|unset"
      );
      expect(isolatedEnv.ADB_SERVER_SOCKET).toBeUndefined();
      expect(isolatedEnv.ANDROID_ADB_SERVER_ADDRESS).toBeUndefined();
      expect(isolatedEnv.ANDROID_ADB_SERVER_PORT).toBeUndefined();
      expect(
        spawnSync(adbPath, ["kill-server"], { env: isolatedEnv }).status
      ).toBe(1);
      expect(
        spawnSync(adbPath, ["nodaemon", "server"], { env: isolatedEnv }).status
      ).toBe(1);
      for (const arguments_ of [
        ["--reply-fd", "1", "nodaemon", "server"],
        ["--reply-fd=3", "fork-server", "server"],
        ["raw", "host:kill"],
        ["wait-for-device", "kill-server"],
        ["wait-for-device", "connect", "attacker:5555"],
      ]) {
        expect(
          spawnSync(adbPath, arguments_, { env: isolatedEnv }).status
        ).toBe(1);
      }
      for (const command of [
        "attach",
        "connect",
        "detach",
        "disconnect",
        "fork-server",
        "forward",
        "kill-server",
        "mdns",
        "nodaemon",
        "pair",
        "reconnect",
        "server",
        "server-status",
        "tcpip",
        "track-devices",
        "usb",
      ]) {
        for (const prefix of [
          ["-s", "emulator-5556"],
          ["--exit-on-write-error"],
        ]) {
          expect(
            spawnSync(adbPath, [...prefix, command], {
              env: isolatedEnv,
            }).status
          ).toBe(1);
        }
      }
      const explicitDevices = spawnSync(
        adbPath,
        ["-s", "emulator-5556", "devices"],
        { encoding: "utf8", env: isolatedEnv }
      );
      expect(explicitDevices.status).toBe(0);
      expect(explicitDevices.stdout).toContain("emulator-5556");
      expect(explicitDevices.stdout).not.toContain("emulator-5554");
      const prefixedDevices = spawnSync(
        adbPath,
        ["--exit-on-write-error", "devices"],
        { encoding: "utf8", env: isolatedEnv }
      );
      expect(prefixedDevices.status).toBe(0);
      expect(prefixedDevices.stdout).toContain("emulator-5556");
      expect(prefixedDevices.stdout).not.toContain("emulator-5554");
      expect((isolatedEnv.PATH ?? "").split(delimiter)).not.toContain(
        dirname(realAdbPath)
      );
      expect((isolatedEnv.PATH ?? "").split(delimiter)).not.toContain(
        dirname(realEmulatorPath)
      );
      expect((isolatedEnv.PATH ?? "").split(delimiter)).not.toContain(
        `${dirname(realAdbPath)}/`
      );
      expect((isolatedEnv.PATH ?? "").split(delimiter)).not.toContain(
        join(dirname(realAdbPath), "..", "platform-tools")
      );
      expect(
        spawnSync(adbPath, ["start-server", "--one-device", "emulator-5554"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
      expect(
        spawnSync(
          adbPath,
          [
            "-s",
            "emulator-5556",
            "start-server",
            "--one-device",
            "emulator-5554",
          ],
          { env: isolatedEnv }
        ).status
      ).toBe(1);
      expect(
        spawnSync(emulatorPath, ["-list-avds"], {
          encoding: "utf8",
          env: isolatedEnv,
        }).stdout.trim()
      ).toBe("Hive_Pixel_7");
      expect(
        spawnSync(emulatorPath, ["-avd", "Pixel_7"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
      expect(
        spawnSync(emulatorPath, ["@Pixel_7"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
      expect(
        spawnSync(emulatorPath, ["@Hive_Pixel_7"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      expect(
        spawnSync(emulatorPath, ["-avd", "Hive_Pixel_7"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      expect(
        spawnSync(emulatorPath, ["-port", "5556", "@Hive_Pixel_7"], {
          env: isolatedEnv,
        }).status
      ).toBe(0);
      for (const arguments_ of [
        ["-port", "5554", "@Hive_Pixel_7"],
        ["-port=5556", "@Hive_Pixel_7"],
        ["-port=5554", "@Hive_Pixel_7"],
        ["-port5554", "@Hive_Pixel_7"],
        ["-ports", "5554,5555", "@Hive_Pixel_7"],
        ["-ports=5554,5555", "@Hive_Pixel_7"],
        ["-ports5554,5555", "@Hive_Pixel_7"],
        ["-avd=Hive_Pixel_7"],
        ["-avd=Pixel_7"],
        ["-avdPixel_7"],
        ["-port"],
        ["-avd"],
      ]) {
        expect(
          spawnSync(emulatorPath, arguments_, { env: isolatedEnv }).status
        ).toBe(1);
      }
      expect(await readFile(emulatorLogPath, "utf8")).toContain(
        "-avd Hive_Pixel_7 -port 5556 -no-window"
      );

      await writeFile(
        join(leasePath, "owner.json"),
        JSON.stringify({ cellId: "cell-b", pid: 123, token: "token-b" })
      );
      await writeFile(join(leasePath, "token"), "token-b");
      expect(
        spawnSync(adbPath, ["-s", "emulator-5556", "shell"], {
          env: isolatedEnv,
        }).status
      ).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it(
    "fails instead of walking away from Hive's allocated viewer port",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "hive-viewer-port-test-"));
      const fakeBin = join(root, "bin");
      const fakeAdb = join(fakeBin, "adb");
      await mkdir(fakeBin, { recursive: true });
      await writeFile(fakeAdb, "#!/bin/sh\nexit 0\n");
      await chmod(fakeAdb, EXECUTABLE_MODE);
      const listener = createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const address = listener.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an occupied TCP port");
      }
      const layout = resolveViewerRuntimeLayout({ isCompiledRuntime: false });
      const output: string[] = [];
      const child = spawn(
        process.execPath,
        [
          layout.executable,
          "--capture",
          "grpc",
          "--headless",
          "--host",
          "127.0.0.1",
          "--port",
          String(address.port),
        ],
        {
          env: {
            ...process.env,
            HIVE_ANDROID_STREAM_DROID_PUBLIC_DIR: layout.publicDirectory,
            HIVE_ANDROID_STREAM_DROID_STRICT_PORT: "1",
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      child.stdout?.on("data", (chunk) => output.push(chunk.toString()));
      child.stderr?.on("data", (chunk) => output.push(chunk.toString()));

      try {
        const exitCode = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("stream-droid did not reject the occupied port"));
          }, VIEWER_START_TIMEOUT_MS);
          child.once("error", reject);
          child.once("exit", (code) => {
            clearTimeout(timeout);
            resolve(code ?? 1);
          });
        });
        const log = output.join("");
        expect(exitCode).toBe(1);
        expect(log).toContain(`port ${address.port} is in use`);
        expect(log).not.toContain(`localhost:${address.port + 1}`);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        await new Promise<void>((resolve) => listener.close(() => resolve()));
        await rm(root, { force: true, recursive: true });
      }
    },
    VIEWER_TEST_TIMEOUT_MS
  );
});
