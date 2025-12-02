import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { AgentRuntimeServiceTag } from "./agents/service";
import { DatabaseService } from "./db";
import { LoggerService } from "./logger";
import { runServerEffect } from "./runtime";
import { WorktreeManagerServiceTag } from "./worktree/manager";

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

describe("serverLayer wiring", () => {
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

  test("provides core service tags", async () => {
    const resolved = await runServerEffect(
      Effect.gen(function* () {
        const worktree = yield* WorktreeManagerServiceTag;
        const agent = yield* AgentRuntimeServiceTag;
        const dbService = yield* DatabaseService;
        const logger = yield* LoggerService;
        return { worktree, agent, dbService, logger } as const;
      })
    );

    expect(typeof resolved.worktree.createManager).toBe("function");
    expect(typeof resolved.agent.ensureAgentSession).toBe("function");
    expect(resolved.dbService.db).toBeDefined();
    expect(typeof resolved.logger.info).toBe("function");
  });

  test("creates and removes worktrees via WorktreeManagerService effect", async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), "worktree-effect-"));
    tempHiveHome = await mkdtemp(join(tmpdir(), "hive-home-effect-"));
    process.env.HIVE_WORKSPACE_ROOT = tempWorkspaceRoot;
    process.env.HIVE_HOME = tempHiveHome;

    const configContents = `
export default {
  opencode: { defaultProvider: "opencode", defaultModel: "big-pickle" },
  promptSources: [],
  templates: { demo: { id: "demo", label: "Demo Template", type: "manual" } },
  defaults: {},
};
`;

    await writeFile(join(tempWorkspaceRoot, "hive.config.ts"), configContents);
    execSync("git init", { cwd: tempWorkspaceRoot, env: gitEnv });
    await writeFile(join(tempWorkspaceRoot, "README.md"), "# workspace");
    execSync("git add .", { cwd: tempWorkspaceRoot, env: gitEnv });
    execSync('git commit -m "init"', { cwd: tempWorkspaceRoot, env: gitEnv });

    const workspacePath = tempWorkspaceRoot;
    if (!workspacePath) {
      throw new Error("Temporary workspace root not initialized");
    }

    const cellId = "effect-cell";
    const location = await runServerEffect(
      Effect.gen(function* () {
        const worktree = yield* WorktreeManagerServiceTag;
        return yield* worktree.createWorktree({
          workspacePath,
          cellId,
        });
      })
    );

    expect(location.path).toContain(cellId);
    expect(existsSync(location.path)).toBe(true);

    await runServerEffect(
      Effect.gen(function* () {
        const worktree = yield* WorktreeManagerServiceTag;
        return yield* worktree.removeWorktree(workspacePath, cellId);
      })
    );

    expect(existsSync(location.path)).toBe(false);
  });
});
