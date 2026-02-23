/// <reference types="vitest" />
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { uninstallHive } from "./uninstall";

const createLogger = () => vi.fn<(message: string) => void>();

describe("uninstallHive", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("removes hive home and managed binary when confirmed", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-uninstall-"));
    tempRoots.push(root);

    const hiveHome = join(root, ".hive");
    const releaseDir = join(hiveHome, "releases", "hive-linux-x64");
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(join(releaseDir, "hive"), "binary");

    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(hiveHome, "current", "hive"), join(binDir, "hive"));

    const stopRuntime = vi.fn(() => "not_running" as const);
    const closeDesktop = vi.fn();

    const exitCode = uninstallHive({
      confirm: true,
      hiveHome,
      hiveBinDir: binDir,
      stopRuntime,
      closeDesktop,
      logInfo: createLogger(),
      logSuccess: createLogger(),
      logWarning: createLogger(),
      logError: createLogger(),
    });

    expect(exitCode).toBe(0);
    expect(stopRuntime).toHaveBeenCalledTimes(1);
    expect(closeDesktop).toHaveBeenCalledTimes(1);
    expect(existsSync(hiveHome)).toBe(false);
    expect(existsSync(join(binDir, "hive"))).toBe(false);
  });

  it("requires --yes confirmation", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-uninstall-"));
    tempRoots.push(root);

    const hiveHome = join(root, ".hive");
    mkdirSync(hiveHome, { recursive: true });

    const stopRuntime = vi.fn(() => "not_running" as const);
    const closeDesktop = vi.fn();
    const logError = createLogger();

    const exitCode = uninstallHive({
      confirm: false,
      hiveHome,
      stopRuntime,
      closeDesktop,
      logInfo: createLogger(),
      logSuccess: createLogger(),
      logWarning: createLogger(),
      logError,
    });

    expect(exitCode).toBe(1);
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(closeDesktop).not.toHaveBeenCalled();
    expect(existsSync(hiveHome)).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      "Uninstall aborted. Re-run with --yes to remove your Hive installation."
    );
  });
});
