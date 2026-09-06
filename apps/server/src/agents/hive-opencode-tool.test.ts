import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureHiveOpencodePlugin,
  ensureHiveToolConfig,
} from "./hive-opencode-tool";

const FILE_MODE_BOUNDARY = 0o1000;
const PRIVATE_FILE_MODE = 0o600;
const UNSAFE_FILE_MODE = 0o644;

async function createGeneratedPlugin() {
  const worktree = await mkdtemp(join(tmpdir(), "hive-plugin-writer-"));
  await ensureHiveOpencodePlugin(worktree);
  return {
    pluginPath: join(worktree, ".opencode", "plugins", "hive", "index.js"),
    worktree,
  };
}

describe("Hive OpenCode plugin writer", () => {
  it("writes the generated plugin inside the worktree", async () => {
    const { pluginPath } = await createGeneratedPlugin();

    const source = await readFile(pluginPath, "utf8");
    expect(source).toContain("hive.cell.v2.r1.tools-context-shell-permission");
  });

  it("leaves an unchanged generated plugin in place", async () => {
    const { pluginPath, worktree } = await createGeneratedPlugin();
    const originalHandle = await open(pluginPath, "r");

    try {
      const originalStats = await originalHandle.stat();
      await ensureHiveOpencodePlugin(worktree);
      const currentStats = await stat(pluginPath);

      expect(currentStats.dev).toBe(originalStats.dev);
      expect(currentStats.ino).toBe(originalStats.ino);
    } finally {
      await originalHandle.close();
    }
  });

  it("replaces an unchanged plugin with unsafe permissions", async () => {
    const { pluginPath, worktree } = await createGeneratedPlugin();
    const originalStats = await stat(pluginPath);
    await chmod(pluginPath, UNSAFE_FILE_MODE);

    await ensureHiveOpencodePlugin(worktree);

    const currentStats = await stat(pluginPath);
    expect(currentStats.ino !== originalStats.ino).toBe(
      process.platform !== "win32"
    );
    expect(
      process.platform === "win32" ||
        currentStats.mode % FILE_MODE_BOUNDARY === PRIVATE_FILE_MODE
    ).toBe(true);
  });

  it("replaces an unchanged hard-linked plugin", async () => {
    const { pluginPath, worktree } = await createGeneratedPlugin();
    const linkedPath = join(worktree, "linked-plugin.js");
    await link(pluginPath, linkedPath);

    await ensureHiveOpencodePlugin(worktree);

    expect((await stat(pluginPath)).ino).not.toBe((await stat(linkedPath)).ino);
  });

  it("refuses a plugin directory symlink that escapes the worktree", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "hive-plugin-worktree-"));
    const external = await mkdtemp(join(tmpdir(), "hive-plugin-external-"));
    await mkdir(join(worktree, ".opencode"));
    await symlink(external, join(worktree, ".opencode", "plugins"));

    await expect(ensureHiveOpencodePlugin(worktree)).rejects.toThrow(
      "Refusing to use unsafe Hive-managed directory"
    );
    await expect(
      readFile(join(external, "hive", "index.js"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Hive tool config writer", () => {
  it("refreshes the cell server URL inside the worktree", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "hive-config-writer-"));

    await ensureHiveToolConfig(worktree, {
      cellId: "cell-1",
      hiveUrl: "http://127.0.0.1:4100",
    });
    await ensureHiveToolConfig(worktree, {
      cellId: "cell-1",
      hiveUrl: "http://127.0.0.1:4200",
    });

    const config = await readFile(
      join(worktree, ".hive", "config.json"),
      "utf8"
    );
    expect(JSON.parse(config)).toEqual({
      cellId: "cell-1",
      hiveUrl: "http://127.0.0.1:4200",
    });
  });

  it("refuses a config directory symlink that escapes the worktree", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "hive-config-worktree-"));
    const external = await mkdtemp(join(tmpdir(), "hive-config-external-"));
    await symlink(external, join(worktree, ".hive"));

    await expect(
      ensureHiveToolConfig(worktree, {
        cellId: "cell-1",
        hiveUrl: "http://127.0.0.1:4100",
      })
    ).rejects.toThrow("Refusing to use unsafe Hive-managed directory");
    await expect(
      readFile(join(external, "config.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
