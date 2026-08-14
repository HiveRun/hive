import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCellEnvironment,
  removeCellRuntimeDir,
  resolveCellArtifactsDir,
  resolveCellEnvironment,
  resolveCellRuntimeDir,
  resolveHiveCliBin,
} from "./cell-environment";

const originalHiveHome = process.env.HIVE_HOME;
const PRIVATE_DIRECTORY_MODE = "700";
const OCTAL_RADIX = 8;
const PERMISSION_DIGIT_COUNT = 3;

const readPermissionMode = async (path: string) =>
  (await stat(path)).mode.toString(OCTAL_RADIX).slice(-PERMISSION_DIGIT_COUNT);

describe("cell environment directories", () => {
  let hiveHome: string | undefined;

  afterEach(async () => {
    if (hiveHome) {
      await rm(hiveHome, { recursive: true, force: true });
    }
    hiveHome = undefined;
    process.env.HIVE_HOME = originalHiveHome;
  });

  it("creates private durable runtime and artifact directories", async () => {
    hiveHome = await mkdtemp(join(tmpdir(), "hive-cell-environment-"));
    process.env.HIVE_HOME = hiveHome;
    const workspacePath = join(hiveHome, "worktree");

    const environment = ensureCellEnvironment("cell-safe", workspacePath);

    expect(environment.HIVE_HOME).toBe(join(workspacePath, ".hive", "home"));
    expect(environment.HIVE_CLI_BIN).toBe(resolveHiveCliBin());
    expect(await readPermissionMode(environment.HIVE_HOME)).toBe("700");
    expect(environment.HIVE_CELL_RUNTIME_DIR).toBe(
      join(hiveHome, "runtime", "cells", "cell-safe")
    );
    expect(environment.HIVE_CELL_ARTIFACTS_DIR).toBe(
      join(hiveHome, "artifacts", "cells", "cell-safe")
    );
    expect(await readPermissionMode(environment.HIVE_CELL_RUNTIME_DIR)).toBe(
      PRIVATE_DIRECTORY_MODE
    );
    expect(await readPermissionMode(environment.HIVE_CELL_ARTIFACTS_DIR)).toBe(
      PRIVATE_DIRECTORY_MODE
    );
  });

  it("resolves source and compiled CLI entry paths centrally", () => {
    expect(
      resolveHiveCliBin({
        execPath: "/opt/bun/bin/bun",
        isCompiledRuntime: false,
        sourceEntryPath: "/workspace/packages/cli/src/index.ts",
      })
    ).toBe("/workspace/packages/cli/src/index.ts");
    expect(
      resolveHiveCliBin({
        execPath: "/opt/hive/hive",
        isCompiledRuntime: true,
        sourceEntryPath: "/workspace/packages/cli/src/index.ts",
      })
    ).toBe("/opt/hive/hive");
  });

  it("always emits the centrally resolved CLI path", () => {
    expect(resolveCellEnvironment("cell-safe", "/workspace").HIVE_CLI_BIN).toBe(
      resolveHiveCliBin()
    );
  });

  it("executes the source HIVE_CLI_BIN directly", () => {
    const cliPath = resolveCellEnvironment(
      "cell-safe",
      "/workspace"
    ).HIVE_CLI_BIN;
    const result = spawnSync(cliPath, ["android", "viewer"], {
      encoding: "utf8",
      env: process.env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      process.platform === "linux" || process.platform === "darwin"
        ? "--grpc-port requires a valid TCP port"
        : "Hive Android commands are not supported"
    );
  });

  it("removes only the selected runtime directory and rejects traversal", async () => {
    hiveHome = await mkdtemp(join(tmpdir(), "hive-cell-removal-"));
    process.env.HIVE_HOME = hiveHome;
    const environment = ensureCellEnvironment(
      "cell-safe",
      join(hiveHome, "worktree")
    );
    const unrelatedPath = join(hiveHome, "runtime", "unrelated.txt");
    await writeFile(unrelatedPath, "keep");

    await removeCellRuntimeDir("cell-safe");

    await expect(access(environment.HIVE_CELL_RUNTIME_DIR)).rejects.toThrow();
    await access(environment.HIVE_CELL_ARTIFACTS_DIR);
    await access(unrelatedPath);
    await expect(removeCellRuntimeDir("../unrelated")).rejects.toThrow(
      "Invalid cell ID"
    );
    expect(() => resolveCellRuntimeDir("nested/cell")).toThrow(
      "Invalid cell ID"
    );
    expect(() => resolveCellArtifactsDir("..")).toThrow("Invalid cell ID");
  });

  it("rejects symlinked environment path components", async () => {
    hiveHome = await mkdtemp(join(tmpdir(), "hive-cell-symlink-"));
    process.env.HIVE_HOME = hiveHome;
    const workspacePath = join(hiveHome, "worktree");
    const externalPath = join(hiveHome, "external");
    await Promise.all([mkdir(workspacePath), mkdir(externalPath)]);
    await symlink(externalPath, join(workspacePath, ".hive"));

    expect(() => ensureCellEnvironment("cell-safe", workspacePath)).toThrow(
      "Cell environment path is not a directory"
    );
    await expect(access(join(externalPath, "home"))).rejects.toThrow();
  });
});
