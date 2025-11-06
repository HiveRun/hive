import { describe, expect, it } from "vitest";
import { createWorktreeService } from "../worktree/service";

describe("WorktreeService", () => {
  it("should create worktree service", () => {
    const service = createWorktreeService();

    expect(service).toBeDefined();
    expect(typeof service.createWorktree).toBe("function");
    expect(typeof service.listWorktrees).toBe("function");
    expect(typeof service.getWorktreeInfo).toBe("function");
    expect(typeof service.removeWorktree).toBe("function");
    expect(typeof service.pruneWorktrees).toBe("function");
    expect(typeof service.worktreeExists).toBe("function");
    expect(typeof service.getWorktreePath).toBe("function");
    expect(typeof service.cleanupAllWorktrees).toBe("function");
  });

  it("should create worktree service with custom base directory", () => {
    const customBaseDir = process.cwd(); // Use existing directory
    const service = createWorktreeService(customBaseDir);

    expect(service).toBeDefined();
    expect(typeof service.createWorktree).toBe("function");
  });
});
