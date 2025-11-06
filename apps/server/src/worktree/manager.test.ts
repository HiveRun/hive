import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktreeManager } from "../worktree/manager";

describe("WorktreeManager", () => {
  const testBaseDir = join(process.cwd(), "test-worktrees");
  // Worktree manager always uses ~/.synthetic/constructs regardless of baseDir
  const { homedir } = require("node:os");
  const constructsDir = join(homedir(), ".synthetic", "constructs");
  const EXPECTED_WORKTREE_COUNT = 3; // main + 2 constructs
  let worktreeManager: ReturnType<typeof createWorktreeManager>;

  beforeEach(async () => {
    // Clean up any existing test directory
    if (existsSync(testBaseDir)) {
      await rm(testBaseDir, { recursive: true, force: true });
    }

    // Clean up any existing worktree directory
    if (existsSync(constructsDir)) {
      await rm(constructsDir, { recursive: true, force: true });
    }

    // Create test directory (ensure parent exists)
    const { dirname } = await import("node:path");
    const parentDir = dirname(testBaseDir);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
    await mkdir(testBaseDir, { recursive: true });

    // Initialize git repo in test directory
    const { execSync } = await import("node:child_process");
    try {
      execSync("git init", { cwd: testBaseDir, stdio: "ignore" });
      execSync("git config user.name 'Test User'", {
        cwd: testBaseDir,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@example.com'", {
        cwd: testBaseDir,
        stdio: "ignore",
      });

      // Create initial commit
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(join(testBaseDir, "test.txt"), "test content")
      );
      execSync("git add .", { cwd: testBaseDir, stdio: "ignore" });
      execSync("git commit -m 'Initial commit'", {
        cwd: testBaseDir,
        stdio: "ignore",
      });
    } catch (error) {
      // If git commands fail, skip cleanup to avoid further errors
      console.error("Test setup failed:", error);
      throw error;
    }

    worktreeManager = createWorktreeManager(testBaseDir);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testBaseDir)) {
      await rm(testBaseDir, { recursive: true, force: true });
    }

    // Clean up actual worktree directory
    if (existsSync(constructsDir)) {
      await rm(constructsDir, { recursive: true, force: true });
    }

    // Prune any stale worktree entries
    try {
      const { execSync } = await import("node:child_process");
      execSync("git worktree prune", { stdio: "ignore" });
    } catch (_error) {
      // Ignore pruning errors
    }
  });

  describe("createWorktree", () => {
    it("should create a worktree for a construct", async () => {
      const constructId = "test-construct";
      const worktreePath = await worktreeManager.createWorktree(constructId);

      expect(worktreePath).toBe(join(constructsDir, constructId));
      expect(existsSync(worktreePath)).toBe(true);

      // Verify it's a proper git worktree
      const worktrees = await worktreeManager.listWorktrees();
      const worktree = worktrees.find((wt) => wt.id === constructId);
      expect(worktree).toBeDefined();
      expect(worktree?.path).toBe(worktreePath);
    });

    it("should throw error if worktree already exists", async () => {
      const constructId = "test-construct";
      await worktreeManager.createWorktree(constructId);

      await expect(worktreeManager.createWorktree(constructId)).rejects.toThrow(
        "Worktree already exists at"
      );
    });

    it("should force create worktree if force option is true", async () => {
      const constructId = "test-construct";
      await worktreeManager.createWorktree(constructId);

      // Should not throw when force is true
      const worktreePath = await worktreeManager.createWorktree(constructId, {
        force: true,
      });
      expect(worktreePath).toBe(join(constructsDir, constructId));
    });

    it("should create worktree on specific branch", async () => {
      const constructId = "test-construct";

      // Create a new branch first
      const { execSync } = await import("node:child_process");
      execSync("git checkout -b feature-branch", { cwd: testBaseDir });
      execSync("git commit --allow-empty -m 'Feature branch commit'", {
        cwd: testBaseDir,
      });
      execSync("git checkout main", { cwd: testBaseDir });

      const worktreePath = await worktreeManager.createWorktree(constructId, {
        branch: "feature-branch",
      });
      expect(worktreePath).toBe(join(constructsDir, constructId));

      const worktrees = await worktreeManager.listWorktrees();
      const worktree = worktrees.find((wt) => wt.id === constructId);
      expect(worktree?.branch).toBe("feature-branch");
    });
  });

  describe("listWorktrees", () => {
    it("should return main worktree by default", async () => {
      const worktrees = await worktreeManager.listWorktrees();

      expect(worktrees).toHaveLength(1);
      const mainWorktree = worktrees[0];
      expect(mainWorktree?.id).toBe("main");
      expect(mainWorktree?.isMain).toBe(true);
      expect(mainWorktree?.path).toBe(testBaseDir);
    });

    it("should include created worktrees", async () => {
      await worktreeManager.createWorktree("construct-1");
      await worktreeManager.createWorktree("construct-2");

      const worktrees = await worktreeManager.listWorktrees();

      expect(worktrees).toHaveLength(EXPECTED_WORKTREE_COUNT);

      const construct1 = worktrees.find((wt) => wt.id === "construct-1");
      const construct2 = worktrees.find((wt) => wt.id === "construct-2");

      expect(construct1).toBeDefined();
      expect(construct2).toBeDefined();
      expect(construct1?.isMain).toBe(false);
      expect(construct2?.isMain).toBe(false);
    });
  });

  describe("getWorktreeInfo", () => {
    it("should return worktree info for existing construct", async () => {
      const constructId = "test-construct";
      await worktreeManager.createWorktree(constructId);

      const worktreeInfo = await worktreeManager.getWorktreeInfo(constructId);

      expect(worktreeInfo).toBeDefined();
      expect(worktreeInfo?.id).toBe(constructId);
      expect(worktreeInfo?.isMain).toBe(false);
    });

    it("should return null for non-existent construct", async () => {
      const worktreeInfo =
        await worktreeManager.getWorktreeInfo("non-existent");
      expect(worktreeInfo).toBeNull();
    });
  });

  describe("worktreeExists", () => {
    it("should return true for existing worktree", async () => {
      const constructId = "test-construct";
      await worktreeManager.createWorktree(constructId);

      const exists = await worktreeManager.worktreeExists(constructId);
      expect(exists).toBe(true);
    });

    it("should return false for non-existent worktree", async () => {
      const exists = await worktreeManager.worktreeExists("non-existent");
      expect(exists).toBe(false);
    });

    it("should return false for main worktree", async () => {
      const exists = await worktreeManager.worktreeExists("main");
      expect(exists).toBe(false);
    });
  });

  describe("removeWorktree", () => {
    it("should remove worktree for construct", async () => {
      const constructId = "test-construct";
      await worktreeManager.createWorktree(constructId);

      await worktreeManager.removeWorktree(constructId);

      const exists = await worktreeManager.worktreeExists(constructId);
      expect(exists).toBe(false);
      expect(existsSync(join(constructsDir, constructId))).toBe(false);
    });

    it("should throw error for non-existent worktree", async () => {
      await expect(
        worktreeManager.removeWorktree("non-existent")
      ).rejects.toThrow("Worktree not found for construct non-existent");
    });

    it("should throw error for main worktree", async () => {
      await expect(worktreeManager.removeWorktree("main")).rejects.toThrow(
        "Cannot remove the main worktree"
      );
    });
  });

  describe("getWorktreePath", () => {
    it("should return correct path for construct", () => {
      const constructId = "test-construct";
      const path = worktreeManager.getWorktreePath(constructId);

      expect(path).toBe(join(constructsDir, constructId));
    });
  });

  describe("cleanupAllWorktrees", () => {
    it("should remove all construct worktrees but keep main", async () => {
      await worktreeManager.createWorktree("construct-1");
      await worktreeManager.createWorktree("construct-2");

      await worktreeManager.cleanupAllWorktrees();

      const worktrees = await worktreeManager.listWorktrees();
      expect(worktrees).toHaveLength(1);
      const mainWorktree = worktrees[0];
      expect(mainWorktree?.id).toBe("main");
      expect(mainWorktree?.isMain).toBe(true);
    });
  });

  describe("pruneWorktrees", () => {
    it("should prune without errors", async () => {
      await expect(worktreeManager.pruneWorktrees()).resolves.not.toThrow();
    });
  });
});
