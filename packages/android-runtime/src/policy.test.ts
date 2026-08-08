import { describe, expect, it } from "vitest";

import {
  buildAndroidEmulatorArgs,
  createAndroidSdkEnvironment,
  getHiveAndroidAbi,
  getHiveAndroidSystemImage,
  resolveAndroidGraphics,
  resolveAndroidRuntimeDirectory,
  resolveAndroidSdkPath,
} from "./policy";

const SYSTEM_PATH_SUFFIX_PATTERN = /\/usr\/bin$/;

describe("Android runtime policy", () => {
  it("resolves configured and standard Android SDK paths", () => {
    expect(
      resolveAndroidSdkPath(
        { ANDROID_SDK_ROOT: "/opt/android-sdk" },
        { homeDirectory: "/home/user", platform: "linux" }
      )
    ).toBe("/opt/android-sdk");
    expect(
      resolveAndroidSdkPath(
        {},
        {
          homeDirectory: "/Users/developer",
          pathExists: (candidate) =>
            candidate.endsWith("/android-sdk/platform-tools/adb"),
          platform: "darwin",
        }
      )
    ).toBe("/Users/developer/android-sdk");
  });

  it("builds an Android SDK environment without dropping inherited values", () => {
    const environment = createAndroidSdkEnvironment(
      {
        ANDROID_SDK_ROOT: "/opt/android-sdk",
        CUSTOM_VALUE: "preserved",
        PATH: "/usr/bin",
      },
      { homeDirectory: "/home/developer", platform: "linux" }
    );

    expect(environment.ANDROID_HOME).toBe("/opt/android-sdk");
    expect(environment.ANDROID_SDK_ROOT).toBe("/opt/android-sdk");
    expect(environment.CUSTOM_VALUE).toBe("preserved");
    expect(environment.PATH).toContain("/opt/android-sdk/platform-tools");
    expect(environment.PATH).toContain(
      "/home/developer/.local/share/mise/shims"
    );
    expect(environment.PATH).toMatch(SYSTEM_PATH_SUFFIX_PATTERN);
  });

  it("maps host architectures to the API 34 google APIs image and product ABI", () => {
    expect(getHiveAndroidAbi("x64")).toBe("x86_64");
    expect(getHiveAndroidAbi("arm64")).toBe("arm64-v8a");
    expect(getHiveAndroidSystemImage("x64")).toBe(
      "system-images;android-34;google_apis;x86_64"
    );
    expect(getHiveAndroidSystemImage("arm64")).toBe(
      "system-images;android-34;google_apis;arm64-v8a"
    );
    expect(() => getHiveAndroidAbi("ia32")).toThrow("does not support ia32");
  });

  it("builds fixed serial, headless, snapshot-free, token gRPC arguments", () => {
    const args = buildAndroidEmulatorArgs({
      connectedSerials: [],
      gpuMode: "host",
      grpcPort: 8558,
    });

    expect(args).toEqual([
      "-avd",
      "Hive_Pixel_7",
      "-port",
      "5580",
      "-netdelay",
      "none",
      "-netspeed",
      "full",
      "-gpu",
      "host",
      "-no-snapshot-load",
      "-no-snapshot-save",
      "-no-boot-anim",
      "-qt-hide-window",
      "-skin",
      "720x1600",
      "-prop",
      "qemu.sf.lcd_density=280",
      "-grpc",
      "8558",
      "-grpc-use-token",
    ]);
    expect(
      buildAndroidEmulatorArgs({
        connectedSerials: ["emulator-5554"],
        gpuMode: "auto",
        grpcPort: 8558,
      })
    ).toContain("-read-only");
  });

  it("uses host graphics and the user Pulse runtime when available", () => {
    expect(
      resolveAndroidGraphics(
        {
          DISPLAY: ":1",
          XAUTHORITY: "/tmp/xauthority",
        },
        {
          platform: "linux",
          validateXAuthority: () => true,
        }
      )
    ).toEqual({ gpuMode: "host", xAuthority: "/tmp/xauthority" });
    expect(
      resolveAndroidRuntimeDirectory(
        { XDG_RUNTIME_DIR: "/tmp" },
        {
          pathExists: (path) => path === "/run/user/1000/pulse/native",
          platform: "linux",
          userId: 1000,
        }
      )
    ).toBe("/run/user/1000");
  });
});
