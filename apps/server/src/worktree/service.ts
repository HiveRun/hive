import { createWorktreeManager } from "../worktree/manager";

export type WorktreeService = ReturnType<typeof createWorktreeManager>;
export type { WorktreeInfo } from "../worktree/manager";

export function createWorktreeService(baseDir?: string): WorktreeService {
  return createWorktreeManager(baseDir);
}
