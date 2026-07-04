import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { captureEnv, setEnv } from "../__tests__/env-test-helpers";
import { browseWorkspaceDirectories } from "./browser";

describe("workspace browser", () => {
  let tempRoot: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "hive-browser-"));
    restoreEnv = captureEnv([
      "HIVE_ALLOWED_WORKSPACE_ROOTS",
      "HIVE_INSTANCE_MODE",
    ]);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    restoreEnv();
  });

  test("private remote mode prevents browsing outside allowed roots", async () => {
    const allowedRoot = join(tempRoot, "workspaces");
    const allowedChild = join(allowedRoot, "project");
    const outsideRoot = join(tempRoot, "outside");
    await mkdir(allowedChild, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });

    setEnv("HIVE_INSTANCE_MODE", "private-remote");
    setEnv("HIVE_ALLOWED_WORKSPACE_ROOTS", allowedRoot);

    const result = await browseWorkspaceDirectories(allowedRoot);
    expect(result.parentPath).toBeNull();
    expect(result.directories.map((entry) => entry.name)).toContain("project");
    await expect(browseWorkspaceDirectories(outsideRoot)).rejects.toThrow(
      "outside allowed remote roots"
    );
  });
});
