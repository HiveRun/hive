import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Elysia } from "elysia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktreeRoutes } from "../routes/worktrees";
import { createWorktreeManager } from "../worktree/manager";

describe("Worktree Routes", () => {
  const testBaseDir = "/tmp/synthetic-test-worktree-api";
  let app: Elysia;
  let worktreeManager: ReturnType<typeof createWorktreeManager>;

  beforeEach(async () => {
    // Clean up any existing test directory
    if (existsSync(testBaseDir)) {
      await rm(testBaseDir, { recursive: true, force: true });
    }

    // Create test directory
    await mkdir(testBaseDir, { recursive: true });

    // Initialize git repo in test directory
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: testBaseDir });
    execSync("git config user.name 'Test User'", { cwd: testBaseDir });
    execSync("git config user.email 'test@example.com'", { cwd: testBaseDir });

    // Create initial commit
    const testFile = join(testBaseDir, "test.txt");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(testFile, "test content")
    );
    execSync("git add .", { cwd: testBaseDir });
    execSync("git commit -m 'Initial commit'", { cwd: testBaseDir });

    // Setup app with worktree routes
    app = new Elysia().use(createWorktreeRoutes(testBaseDir));
    worktreeManager = createWorktreeManager(testBaseDir);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testBaseDir)) {
      await rm(testBaseDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/worktrees", () => {
    it("should list all worktrees", async () => {
      const response = (await app
        .handle(new Request("http://localhost/api/worktrees"))
        .then((res) => res.json())) as { worktrees: any[] };

      expect(response).toHaveProperty("worktrees");
      expect(Array.isArray(response.worktrees)).toBe(true);
      expect(response.worktrees).toHaveLength(1); // Only main worktree initially

      const mainWorktree = response.worktrees[0];
      expect(mainWorktree.id).toBe("main");
      expect(mainWorktree.isMain).toBe(true);
      expect(mainWorktree.path).toBe(testBaseDir);
    });

    it("should include created worktrees in list", async () => {
      // Create a worktree first
      await worktreeManager.createWorktree("test-construct");

      const response = (await app
        .handle(new Request("http://localhost/api/worktrees"))
        .then((res) => res.json())) as { worktrees: any[] };

      expect(response.worktrees).toHaveLength(2); // main + test-construct

      const testWorktree = response.worktrees.find(
        (wt: any) => wt.id === "test-construct"
      );
      expect(testWorktree).toBeDefined();
      expect(testWorktree?.id).toBe("test-construct");
      expect(testWorktree?.isMain).toBe(false);
    });
  });

  describe("GET /api/worktrees/:constructId", () => {
    it("should get specific worktree", async () => {
      // Create a worktree first
      await worktreeManager.createWorktree("test-construct");

      const response = (await app
        .handle(new Request("http://localhost/api/worktrees/test-construct"))
        .then((res) => res.json())) as any;

      expect(response.id).toBe("test-construct");
      expect(response.isMain).toBe(false);
      expect(response.path).toContain("test-construct");
    });

    it("should return 404 for non-existent worktree", async () => {
      const response = (await app
        .handle(new Request("http://localhost/api/worktrees/non-existent"))
        .then((res) => res.json())) as any;

      expect(response.message).toBe("Worktree not found");
    });
  });

  describe("POST /api/worktrees/:constructId", () => {
    it("should create worktree for construct", async () => {
      const response = (await app
        .handle(
          new Request("http://localhost/api/worktrees/new-construct", {
            method: "POST",
            body: JSON.stringify({ branch: "feature-branch" }),
            headers: { "Content-Type": "application/json" },
          })
        )
        .then((res) => res.json())) as any;

      expect(response.message).toContain("Worktree created");
      expect(response.path).toContain("new-construct");
    });

    it("should handle worktree creation conflicts", async () => {
      // Create worktree first
      await worktreeManager.createWorktree("conflict-construct");

      const response = (await app
        .handle(
          new Request("http://localhost/api/worktrees/conflict-construct", {
            method: "POST",
            body: JSON.stringify({}),
            headers: { "Content-Type": "application/json" },
          })
        )
        .then((res) => res.json())) as any;

      expect(response.message).toContain("already exists");
    });
  });

  describe("DELETE /api/worktrees/:constructId", () => {
    it("should delete worktree", async () => {
      // Create worktree first
      await worktreeManager.createWorktree("delete-construct");

      const response = (await app
        .handle(
          new Request("http://localhost/api/worktrees/delete-construct", {
            method: "DELETE",
          })
        )
        .then((res) => res.json())) as any;

      expect(response.message).toContain("Worktree removed");

      // Verify worktree no longer exists
      const exists = await worktreeManager.worktreeExists("delete-construct");
      expect(exists).toBe(false);
    });

    it("should return 404 when deleting non-existent worktree", async () => {
      const response = (await app
        .handle(
          new Request("http://localhost/api/worktrees/non-existent", {
            method: "DELETE",
          })
        )
        .then((res) => res.json())) as any;

      expect(response.message).toBe("Worktree not found");
    });
  });

  describe("POST /api/worktrees/prune", () => {
    it("should prune stale worktrees", async () => {
      // Create some worktrees
      await worktreeManager.createWorktree("prune-test-1");
      await worktreeManager.createWorktree("prune-test-2");

      const response = (await app
        .handle(
          new Request("http://localhost/api/worktrees/prune", {
            method: "POST",
          })
        )
        .then((res) => res.json())) as any;

      expect(response.message).toContain("Worktrees pruned");
    });
  });
});
