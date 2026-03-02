import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktreeManager, resolveHiveServerUrl } from "./manager";

describe("resolveHiveServerUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HIVE_URL = undefined;
    process.env.PORT = undefined;
    process.env.HOST = undefined;
    process.env.HOSTNAME = undefined;
    process.env.HIVE_PROTOCOL = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns http://localhost:3000 by default", () => {
    expect(resolveHiveServerUrl()).toBe("http://localhost:3000");
  });

  it("uses localhost not 127.0.0.1 for IPv4/IPv6 compatibility", () => {
    // Server may bind IPv6 only; localhost resolves correctly for either
    const url = resolveHiveServerUrl();
    expect(url).not.toContain("127.0.0.1");
    expect(url).toContain("localhost");
  });

  it("uses HIVE_URL when set", () => {
    process.env.HIVE_URL = "https://custom.example.com:8080";
    expect(resolveHiveServerUrl()).toBe("https://custom.example.com:8080");
  });

  it("respects PORT env var", () => {
    process.env.PORT = "4000";
    expect(resolveHiveServerUrl()).toBe("http://localhost:4000");
  });
});

describe("createWorktreeManager include copy", () => {
  const originalEnv = { ...process.env };
  let tempRoot = "";
  let workspacePath = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "hive-worktree-test-"));
    workspacePath = join(tempRoot, "workspace");
    await mkdir(workspacePath, { recursive: true });

    process.env.HIVE_HOME = join(tempRoot, "hive-home");

    runGit(workspacePath, ["init"]);
    runGit(workspacePath, ["config", "user.email", "test@example.com"]);
    runGit(workspacePath, ["config", "user.name", "Test User"]);

    await writeFile(join(workspacePath, ".env"), "API_KEY=secret\n", "utf8");
    await writeFile(join(workspacePath, "README.md"), "workspace\n", "utf8");

    runGit(workspacePath, ["add", "."]);
    runGit(workspacePath, ["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("copies include patterns into the worktree", async () => {
    const manager = createWorktreeManager(workspacePath, {
      templates: {
        "with-env": {
          id: "with-env",
          label: "With Env",
          type: "manual",
          includePatterns: [".env"],
        },
      },
    });

    const location = await manager.createWorktree("cell-subprocess-test", {
      templateId: "with-env",
      force: true,
    });

    const copiedEnv = await readFile(join(location.path, ".env"), "utf8");
    expect(copiedEnv).toContain("API_KEY=secret");
  });

  it("creates the isolated cell branch from a selected source branch", async () => {
    const baseBranch = runGitRead(workspacePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);

    runGit(workspacePath, ["checkout", "-b", "feature/start-point"]);
    await writeFile(join(workspacePath, "feature.txt"), "feature\n", "utf8");
    runGit(workspacePath, ["add", "feature.txt"]);
    runGit(workspacePath, ["commit", "-m", "feature commit"]);
    const featureCommit = runGitRead(workspacePath, ["rev-parse", "HEAD"]);

    runGit(workspacePath, ["checkout", baseBranch]);

    const manager = createWorktreeManager(workspacePath);
    const location = await manager.createWorktree("cell-start-point", {
      force: true,
      startPoint: {
        mode: "branch",
        value: "feature/start-point",
      },
    });

    expect(location.baseCommit).toBe(featureCommit);
    expect(runGitRead(location.path, ["rev-parse", "HEAD"])).toBe(
      featureCommit
    );
  });

  it("rejects invalid GitHub PR references", async () => {
    const manager = createWorktreeManager(workspacePath);

    await expect(
      manager.createWorktree("cell-invalid-pr", {
        force: true,
        startPoint: {
          mode: "pr",
          value: "not-a-pr",
        },
      })
    ).rejects.toThrow("Invalid GitHub PR reference");
  });
});

function runGit(cwd: string, args: string[]) {
  const child = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (child.exitCode !== 0) {
    const stderr = child.stderr.toString().trim();
    throw new Error(
      `git ${args.join(" ")} failed with code ${child.exitCode}${stderr ? `: ${stderr}` : ""}`
    );
  }
}

function runGitRead(cwd: string, args: string[]): string {
  const child = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (child.exitCode !== 0) {
    const stderr = child.stderr.toString().trim();
    throw new Error(
      `git ${args.join(" ")} failed with code ${child.exitCode}${stderr ? `: ${stderr}` : ""}`
    );
  }

  return child.stdout.toString().trim();
}
