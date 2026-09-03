import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureHiveOpencodePlugin,
  ensureHiveToolConfig,
} from "./hive-opencode-tool";

describe("Hive OpenCode plugin writer", () => {
  it("writes the generated plugin inside the worktree", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "hive-plugin-writer-"));

    await ensureHiveOpencodePlugin(worktree);

    const source = await readFile(
      join(worktree, ".opencode", "plugins", "hive", "index.js"),
      "utf8"
    );
    expect(source).toContain("hive.cell.v2.r1.tools-context-shell-permission");
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
