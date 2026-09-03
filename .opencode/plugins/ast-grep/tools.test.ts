import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAstGrepTools } from "./tools";

describe("ast-grep path boundaries", () => {
  it("refuses replacement paths that escape through a symlink", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "hive-ast-grep-worktree-"));
    const external = await mkdtemp(join(tmpdir(), "hive-ast-grep-external-"));
    await writeFile(join(external, "outside.ts"), "console.log('outside')\n");
    await mkdir(join(worktree, "src"));
    await symlink(external, join(worktree, "src", "linked"));
    const replaceTool = createAstGrepTools(worktree)[1];

    const result = await replaceTool.execute(
      {
        pattern: "console.log($MSG)",
        rewrite: "logger.info($MSG)",
        lang: "typescript",
        paths: ["src/linked/outside.ts"],
        dryRun: false,
      },
      {}
    );

    expect(result.content).toContain(
      "Path is outside the allowed workspace boundary"
    );
  });
});
