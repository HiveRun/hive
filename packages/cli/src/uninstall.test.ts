/// <reference types="vitest" />
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { uninstallHive } from "./uninstall";

const createLogger = () => vi.fn<(message: string) => void>();

const pathExists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

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
    expect(pathExists(join(binDir, "hive"))).toBe(false);
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

  it("continues uninstall when daemon stop check fails", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-uninstall-"));
    tempRoots.push(root);

    const hiveHome = join(root, ".hive");
    mkdirSync(hiveHome, { recursive: true });
    writeFileSync(join(hiveHome, "hive.env"), "test");

    const stopRuntime = vi.fn(() => "failed" as const);
    const closeDesktop = vi.fn();
    const logWarning = createLogger();

    const exitCode = uninstallHive({
      confirm: true,
      hiveHome,
      stopRuntime,
      closeDesktop,
      logInfo: createLogger(),
      logSuccess: createLogger(),
      logWarning,
      logError: createLogger(),
    });

    expect(exitCode).toBe(0);
    expect(closeDesktop).toHaveBeenCalledTimes(1);
    expect(existsSync(hiveHome)).toBe(false);
    expect(logWarning).toHaveBeenCalledWith(
      "Unable to confirm daemon shutdown. Continuing uninstall and removing local files."
    );
  });

  it("removes managed shell path entries and completion scripts", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-uninstall-"));
    tempRoots.push(root);

    const homeDir = join(root, "home");
    const xdgConfigHome = join(homeDir, ".config");
    const zshCustom = join(homeDir, ".zsh-custom");

    const hiveHome = join(homeDir, ".hive");
    const binDir = join(hiveHome, "bin");

    mkdirSync(hiveHome, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const zshrcPath = join(homeDir, ".zshrc");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      zshrcPath,
      [
        "export PATH=/usr/local/bin:$PATH",
        "# hive",
        `export PATH=${binDir}:$PATH`,
      ].join("\n")
    );

    const fishConfigPath = join(homeDir, ".config", "fish", "config.fish");
    mkdirSync(join(homeDir, ".config", "fish"), { recursive: true });
    writeFileSync(fishConfigPath, `# hive\nfish_add_path ${binDir}\n`);

    const zshCompletionPath = join(zshCustom, "completions", "_hive");
    mkdirSync(join(zshCustom, "completions"), { recursive: true });
    writeFileSync(zshCompletionPath, "#compdef hive\n_hive() {}\n");

    const fishCompletionPath = join(
      homeDir,
      ".config",
      "fish",
      "completions",
      "hive.fish"
    );
    mkdirSync(join(homeDir, ".config", "fish", "completions"), {
      recursive: true,
    });
    writeFileSync(fishCompletionPath, "# fish completion for hive\n");

    const stopRuntime = vi.fn(() => "not_running" as const);
    const closeDesktop = vi.fn();
    const logInfo = createLogger();
    const logWarning = createLogger();

    const exitCode = uninstallHive({
      confirm: true,
      hiveHome,
      hiveBinDir: binDir,
      homeDir,
      xdgConfigHome,
      zshCustom,
      shellPath: "/bin/zsh",
      stopRuntime,
      closeDesktop,
      logInfo,
      logSuccess: createLogger(),
      logWarning,
      logError: createLogger(),
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(zshrcPath, "utf8")).not.toContain(
      `# hive\nexport PATH=${binDir}:$PATH`
    );
    expect(readFileSync(fishConfigPath, "utf8")).not.toContain(
      `fish_add_path ${binDir}`
    );
    expect(existsSync(zshCompletionPath)).toBe(false);
    expect(existsSync(fishCompletionPath)).toBe(false);
    expect(logWarning).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      [
        "Shell cleanup:",
        "  - removed PATH entries from 2 shell file(s)",
        "  - removed 2 completion script(s)",
        "  - refresh this shell now: unfunction _hive 2>/dev/null; compdef -d hive 2>/dev/null; hash -r",
      ].join("\n")
    );
  });
});
