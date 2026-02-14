import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { agentRuntimeService } from "./agents/service";
import { DatabaseService } from "./db";
import { LoggerService } from "./logger";
import { worktreeManagerService } from "./worktree/manager";

const originalHiveHome = process.env.HIVE_HOME;
const originalWorkspaceRoot = process.env.HIVE_WORKSPACE_ROOT;

let tempWorkspaceRoot: string | null = null;
let tempHiveHome: string | null = null;

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Hive Test",
  GIT_AUTHOR_EMAIL: "hive-test@hive.local",
  GIT_COMMITTER_NAME: "Hive Test",
  GIT_COMMITTER_EMAIL: "hive-test@hive.local",
};

describe("runtime service wiring", () => {
  afterEach(async () => {
    if (tempWorkspaceRoot) {
      await rm(tempWorkspaceRoot, { recursive: true, force: true });
      tempWorkspaceRoot = null;
    }
    if (tempHiveHome) {
      await rm(tempHiveHome, { recursive: true, force: true });
      tempHiveHome = null;
    }
    process.env.HIVE_HOME = originalHiveHome;
    process.env.HIVE_WORKSPACE_ROOT = originalWorkspaceRoot;
  });

  test("provides core services", () => {
    const resolved = {
      worktree: worktreeManagerService,
      agent: agentRuntimeService,
      dbService: DatabaseService,
      logger: LoggerService,
    } as const;

    expect(typeof resolved.worktree.createManager).toBe("function");
    expect(typeof resolved.agent.ensureAgentSession).toBe("function");
    expect(resolved.dbService.db).toBeDefined();
    expect(typeof resolved.logger.info).toBe("function");
  });

  test("creates and removes worktrees via WorktreeManagerService", async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), "worktree-service-"));
    tempHiveHome = await mkdtemp(join(tmpdir(), "hive-home-service-"));
    process.env.HIVE_WORKSPACE_ROOT = tempWorkspaceRoot;
    process.env.HIVE_HOME = tempHiveHome;

    const configContents = `{
  "opencode": { "defaultProvider": "opencode", "defaultModel": "big-pickle" },
  "promptSources": [],
  "templates": {
    "demo": { "id": "demo", "label": "Demo Template", "type": "manual" }
  },
  "defaults": {}
}
`;

    await writeFile(
      join(tempWorkspaceRoot, "hive.config.json"),
      configContents
    );
    execSync("git init", { cwd: tempWorkspaceRoot, env: gitEnv });
    await writeFile(join(tempWorkspaceRoot, "README.md"), "# workspace");
    execSync("git add .", { cwd: tempWorkspaceRoot, env: gitEnv });
    execSync('git commit -m "init"', { cwd: tempWorkspaceRoot, env: gitEnv });

    const workspacePath = tempWorkspaceRoot;
    if (!workspacePath) {
      throw new Error("Temporary workspace root not initialized");
    }

    const cellId = "service-cell";
    const location = await worktreeManagerService.createWorktree({
      workspacePath,
      cellId,
    });

    expect(location.path).toContain(cellId);
    expect(existsSync(location.path)).toBe(true);

    await worktreeManagerService.removeWorktree(workspacePath, cellId);

    expect(existsSync(location.path)).toBe(false);
  });
});
