import { describe, expect, it, vi } from "vitest";

import {
  assertAndroidPlatformSupported,
  dispatchAndroidCommand,
  parseAndroidCommand,
} from "./command";

const EMULATOR_EXIT_CODE = 7;
const VIEWER_EXIT_CODE = 9;

describe("Hive Android command dispatcher", () => {
  it("ignores non-Android CLI commands", async () => {
    expect(parseAndroidCommand(["info"])).toBeNull();
    expect(await dispatchAndroidCommand(["info"])).toBeNull();
  });

  it("parses emulator options separately from opaque product argv", () => {
    expect(
      parseAndroidCommand([
        "android",
        "emulator",
        "--grpc-port",
        "8558",
        "--",
        "bun",
        "run",
        "android:emulator",
        "--flag",
      ])
    ).toEqual({
      grpcPort: 8558,
      kind: "emulator",
      productArgv: ["bun", "run", "android:emulator", "--flag"],
    });
  });

  it("parses viewer ports in either order", () => {
    expect(
      parseAndroidCommand([
        "android",
        "viewer",
        "--grpc-port",
        "8558",
        "--port",
        "41000",
      ])
    ).toEqual({ grpcPort: 8558, kind: "viewer", port: 41_000 });
    expect(
      parseAndroidCommand([
        "android",
        "viewer",
        "--port",
        "41000",
        "--grpc-port",
        "8558",
      ])
    ).toEqual({ grpcPort: 8558, kind: "viewer", port: 41_000 });
  });

  it("rejects missing separators, commands, and invalid ports", () => {
    expect(() =>
      parseAndroidCommand(["android", "emulator", "--grpc-port", "8558", "bun"])
    ).toThrow("Usage: hive android emulator");
    expect(() =>
      parseAndroidCommand([
        "android",
        "viewer",
        "--port",
        "invalid",
        "--grpc-port",
        "8558",
      ])
    ).toThrow("--port requires a valid TCP port");
    expect(() => parseAndroidCommand(["android", "unknown"])).toThrow(
      "Expected emulator or viewer"
    );
  });

  it("dispatches without importing command-specific policy into Clipanion", async () => {
    const runEmulator = vi.fn().mockResolvedValue(EMULATOR_EXIT_CODE);
    const runViewer = vi.fn().mockResolvedValue(VIEWER_EXIT_CODE);
    const env = { HIVE_CELL_ID: "cell-a" };

    expect(
      await dispatchAndroidCommand(
        [
          "android",
          "emulator",
          "--grpc-port",
          "8558",
          "--",
          "product",
          "start",
        ],
        { env, runEmulator, runViewer }
      )
    ).toBe(EMULATOR_EXIT_CODE);
    expect(runEmulator).toHaveBeenCalledWith({
      env,
      grpcPort: 8558,
      productArgv: ["product", "start"],
    });

    expect(
      await dispatchAndroidCommand(
        ["android", "viewer", "--port", "41000", "--grpc-port", "8558"],
        { env, runEmulator, runViewer }
      )
    ).toBe(VIEWER_EXIT_CODE);
    expect(runViewer).toHaveBeenCalledWith({
      env,
      grpcPort: 8558,
      port: 41_000,
    });
  });

  it("turns Android parsing failures into a command exit code", async () => {
    const writeError = vi.fn();
    expect(
      await dispatchAndroidCommand(["android", "viewer"], { writeError })
    ).toBe(1);
    expect(writeError).toHaveBeenCalledWith(
      expect.stringContaining("--grpc-port requires a valid TCP port")
    );
  });

  it("rejects Android commands on unsupported hosts before dispatch", async () => {
    const runViewer = vi.fn();
    const writeError = vi.fn();

    expect(() => assertAndroidPlatformSupported("win32")).toThrow(
      "not supported on win32"
    );
    expect(
      await dispatchAndroidCommand(
        ["android", "viewer", "--port", "41000", "--grpc-port", "8558"],
        { platform: "win32", runViewer, writeError }
      )
    ).toBe(1);
    expect(runViewer).not.toHaveBeenCalled();
    expect(writeError).toHaveBeenCalledWith(
      expect.stringContaining("Run Hive on a Linux or macOS host")
    );
  });
});
