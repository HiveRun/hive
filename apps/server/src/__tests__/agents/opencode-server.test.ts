import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureHiveOpencodeToolDirectory } from "../../agents/opencode-server";

describe("ensureHiveOpencodeToolDirectory", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();

    await rm("/tmp/hive-opencode", { recursive: true, force: true });

    vi.spyOn(process, "cwd").mockReturnValue("/tmp/hive-opencode-workspace");
    await rm(process.cwd(), { recursive: true, force: true });
  });

  it("writes hive tool into OPENCODE_CONFIG_DIR", async () => {
    const hiveHome = "/tmp/hive-opencode";
    process.env.HIVE_HOME = hiveHome;

    const workspaceRoot = process.cwd();
    const sourceDir = join(workspaceRoot, ".opencode", "tool");
    await mkdir(sourceDir, { recursive: true });

    const configDir = await ensureHiveOpencodeToolDirectory();

    expect(configDir).toBe(join(hiveHome, "opencode"));

    const destPath = join(configDir, "tool", "hive.ts");
    await expect(stat(destPath)).resolves.toBeDefined();

    const payload = await Bun.file(destPath).text();
    expect(payload).toContain("hive_submit_plan");
  });
});
