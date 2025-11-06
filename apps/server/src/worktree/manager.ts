import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { simpleGit } from "simple-git";

// Git worktree parsing constants
const WORKTREE_PREFIX = "worktree ";
const HEAD_PREFIX = "HEAD ";
const BRANCH_PREFIX = "branch ";
const REFS_HEADS_PREFIX = "refs/heads/";

// String prefix lengths
const WORKTREE_PREFIX_LENGTH = WORKTREE_PREFIX.length;
const HEAD_PREFIX_LENGTH = HEAD_PREFIX.length;
const BRANCH_PREFIX_LENGTH = BRANCH_PREFIX.length;

export type WorktreeInfo = {
  id: string;
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
};

export type WorktreeCreateOptions = {
  branch?: string;
  force?: boolean;
};

export type WorktreeManager = {
  createWorktree(
    constructId: string,
    options?: WorktreeCreateOptions
  ): Promise<string>;
  listWorktrees(): Promise<WorktreeInfo[]>;
  getWorktreeInfo(constructId: string): Promise<WorktreeInfo | null>;
  removeWorktree(constructId: string): Promise<void>;
  pruneWorktrees(): Promise<void>;
  worktreeExists(constructId: string): Promise<boolean>;
  getWorktreePath(constructId: string): string;
  cleanupAllWorktrees(): Promise<void>;
};

export function createWorktreeManager(
  baseDir: string = process.cwd()
): WorktreeManager {
  const git = simpleGit(baseDir);
  const homeDir = require("node:os").homedir();
  const constructsDir = join(homeDir, ".synthetic", "constructs");

  /**
   * Initialize constructs directory if it doesn't exist
   */
  async function ensureConstructsDir(): Promise<void> {
    if (!existsSync(constructsDir)) {
      await mkdir(constructsDir, { recursive: true });
    }
  }

  /**
   * Get the main repository path
   */
  function getMainRepoPath(): string {
    try {
      return execSync("git rev-parse --show-toplevel", {
        encoding: "utf8",
        cwd: baseDir,
      }).trim();
    } catch (_error) {
      // Fallback to baseDir if git command fails (e.g., in tests)
      return baseDir;
    }
  }

  /**
   * Read and parse .gitignore patterns
   */
  function getGitignorePatterns(mainRepoPath: string): string[] {
    const gitignorePath = join(mainRepoPath, ".gitignore");

    if (!existsSync(gitignorePath)) {
      return [];
    }

    const fs = require("node:fs");

    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      return gitignoreContent
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line && !line.startsWith("#"));
    } catch (_error) {
      return [];
    }
  }

  /**
   * Get essential files that should always be copied
   */
  function getEssentialFiles(): string[] {
    return [
      ".env.example",
      ".env.local",
      ".env.development.local",
      ".env.test.local",
      ".env.production.local",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ];
  }

  /**
   * Collect files to copy from main repo
   */
  function collectFilesToCopy(mainRepoPath: string): string[] {
    const essentialFiles = getEssentialFiles();
    const gitignorePatterns = getGitignorePatterns(mainRepoPath);
    const filesToCopy: string[] = [];

    // Check essential files first
    for (const file of essentialFiles) {
      const sourcePath = join(mainRepoPath, file);
      if (existsSync(sourcePath)) {
        filesToCopy.push(file);
      }
    }

    // Check gitignored patterns for existing files/directories
    for (const pattern of gitignorePatterns) {
      // Skip patterns that are already in essential files
      if (essentialFiles.includes(pattern)) {
        continue;
      }

      const sourcePath = join(mainRepoPath, pattern);
      if (existsSync(sourcePath)) {
        filesToCopy.push(pattern);
      }
    }

    return filesToCopy;
  }

  /**
   * Copy a single file or directory to worktree
   */
  async function copyToWorktree(
    mainRepoPath: string,
    worktreePath: string,
    file: string
  ): Promise<void> {
    const fs = require("node:fs");
    const path = require("node:path");

    const sourcePath = join(mainRepoPath, file);
    const targetPath = join(worktreePath, file);

    try {
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        // For directories, we need to copy recursively
        await copyDirectory(sourcePath, targetPath);
      } else {
        // For files, copy directly
        const targetDir = path.dirname(targetPath);
        await mkdir(targetDir, { recursive: true });
        await copyFile(sourcePath, targetPath);
      }
    } catch (_error) {
      // Ignore copy errors for non-essential files
    }
  }

  /**
   * Copy gitignored files from main repo to worktree
   */
  async function copyGitignoredFiles(worktreePath: string): Promise<void> {
    const mainRepoPath = getMainRepoPath();
    const filesToCopy = collectFilesToCopy(mainRepoPath);

    // Copy the files and directories
    for (const file of filesToCopy) {
      await copyToWorktree(mainRepoPath, worktreePath, file);
    }
  }

  /**
   * Copy directory recursively
   */
  async function copyDirectory(source: string, target: string): Promise<void> {
    const fs = require("node:fs");
    const path = require("node:path");

    // Create target directory
    await mkdir(target, { recursive: true });

    // Read source directory
    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
      } else {
        await copyFile(sourcePath, targetPath);
      }
    }
  }

  /**
   * Get the current branch name
   */
  async function getCurrentBranch(): Promise<string> {
    try {
      const status = await git.status();
      return status.current || "main";
    } catch (_error) {
      return "main";
    }
  }

  /**
   * Handle existing worktree removal
   */
  async function handleExistingWorktree(
    worktreePath: string,
    force: boolean
  ): Promise<void> {
    if (!existsSync(worktreePath)) {
      return;
    }

    if (force) {
      try {
        await git.raw(["worktree", "remove", "--force", worktreePath]);
      } catch (_error) {
        // If removal fails, try removing the directory directly
        const { rm } = await import("node:fs/promises");
        await rm(worktreePath, { recursive: true, force: true });
      }
    } else {
      throw new Error(`Worktree already exists at ${worktreePath}`);
    }
  }

  /**
   * Resolve or create branch for worktree
   */
  async function resolveBranch(
    constructId: string,
    options: WorktreeCreateOptions
  ): Promise<string> {
    if (options.branch) {
      const branch = await ensureBranchExists(options.branch);
      if (!branch) {
        throw new Error(`Failed to create or find branch: ${options.branch}`);
      }
      return branch;
    }

    const constructBranch = `construct-${constructId}`;
    const branch = await ensureBranchExists(constructBranch);
    if (!branch) {
      throw new Error(`Failed to create or find branch: ${constructBranch}`);
    }
    return branch;
  }

  /**
   * Ensure branch exists, create if needed
   */
  async function ensureBranchExists(
    branchName: string
  ): Promise<string | null> {
    try {
      await git.raw(["show-ref", "--verify", `refs/heads/${branchName}`]);
      return branchName;
    } catch {
      try {
        const currentBranch = await getCurrentBranch();
        await git.raw(["branch", branchName, currentBranch]);
        return branchName;
      } catch (_error) {
        return null;
      }
    }
  }

  /**
   * Parse worktree section from git output
   */
  function parseWorktreeSection(section: string): {
    path: string;
    commit: string;
    branch: string;
  } | null {
    const lines = section.split("\n");
    let path = "";
    let commit = "";
    let branch = "";

    for (const line of lines) {
      if (line.startsWith(WORKTREE_PREFIX)) {
        path = line.substring(WORKTREE_PREFIX_LENGTH);
      } else if (line.startsWith(HEAD_PREFIX)) {
        commit = line.substring(HEAD_PREFIX_LENGTH);
      } else if (line.startsWith(BRANCH_PREFIX)) {
        const branchRef = line.substring(BRANCH_PREFIX_LENGTH);
        branch = branchRef.replace(REFS_HEADS_PREFIX, "");
      }
    }

    return path && commit ? { path, commit, branch: branch || "HEAD" } : null;
  }

  /**
   * Extract construct ID from worktree path
   */
  function extractConstructId(worktreePath: string): string {
    const relativePath = relative(constructsDir, worktreePath);
    return relativePath.includes("..") ? "main" : relativePath;
  }

  return {
    /**
     * Create a new worktree for a construct
     */
    async createWorktree(
      constructId: string,
      options: WorktreeCreateOptions = {}
    ): Promise<string> {
      await ensureConstructsDir();

      const worktreePath = join(constructsDir, constructId);

      // Handle existing worktree
      await handleExistingWorktree(worktreePath, options.force ?? false);

      // Resolve branch
      const branch = await resolveBranch(constructId, options);

      try {
        // Create worktree
        await git.raw(["worktree", "add", worktreePath, branch]);

        // Copy gitignored files
        await copyGitignoredFiles(worktreePath);

        return worktreePath;
      } catch (error) {
        // Clean up on failure
        if (existsSync(worktreePath)) {
          await git.raw(["worktree", "remove", "--force", worktreePath]);
        }
        throw error;
      }
    },

    /**
     * List all worktrees in the repository
     */
    async listWorktrees(): Promise<WorktreeInfo[]> {
      try {
        const worktreeList = await git.raw(["worktree", "list", "--porcelain"]);
        const mainRepoPath = getMainRepoPath();

        const sections = worktreeList.trim().split("\n\n");
        const parsedWorktrees: Array<{
          path: string;
          commit: string;
          branch: string;
        }> = [];

        // Parse each section
        for (const section of sections) {
          const parsed = parseWorktreeSection(section);
          if (parsed) {
            parsedWorktrees.push(parsed);
          }
        }

        // Convert to WorktreeInfo format
        return parsedWorktrees.map((worktree) => {
          const isMain = worktree.path === mainRepoPath;
          return {
            id: isMain ? "main" : extractConstructId(worktree.path),
            path: worktree.path,
            branch: worktree.branch,
            commit: worktree.commit,
            isMain,
          };
        });
      } catch (_error) {
        // Fallback: return only main worktree
        const mainRepoPath = getMainRepoPath();
        return [
          {
            id: "main",
            path: mainRepoPath,
            branch: await getCurrentBranch(),
            commit: "HEAD",
            isMain: true,
          },
        ];
      }
    },

    /**
     * Get worktree info for a specific construct
     */
    async getWorktreeInfo(constructId: string): Promise<WorktreeInfo | null> {
      const worktrees = await this.listWorktrees();
      return worktrees.find((wt) => wt.id === constructId) || null;
    },

    /**
     * Remove a worktree (prune and delete)
     */
    async removeWorktree(constructId: string): Promise<void> {
      const worktreeInfo = await this.getWorktreeInfo(constructId);

      if (!worktreeInfo) {
        throw new Error(`Worktree not found for construct ${constructId}`);
      }

      if (worktreeInfo.isMain) {
        throw new Error("Cannot remove the main worktree");
      }

      try {
        // Remove the worktree
        await git.raw(["worktree", "remove", "--force", worktreeInfo.path]);

        // Prune stale worktrees
        await git.raw(["worktree", "prune"]);
      } catch (error) {
        throw new Error(
          `Failed to remove worktree for construct ${constructId}: ${error}`
        );
      }
    },

    /**
     * Prune stale worktrees
     */
    async pruneWorktrees(): Promise<void> {
      try {
        await git.raw(["worktree", "prune"]);
      } catch (_error) {
        // Ignore prune errors
      }
    },

    /**
     * Check if a worktree exists for a construct
     */
    async worktreeExists(constructId: string): Promise<boolean> {
      const worktreeInfo = await this.getWorktreeInfo(constructId);
      return worktreeInfo !== null && !worktreeInfo.isMain;
    },

    /**
     * Get the path to a construct's worktree
     */
    getWorktreePath(constructId: string): string {
      return join(constructsDir, constructId);
    },

    /**
     * Clean up all construct worktrees (useful for testing)
     */
    async cleanupAllWorktrees(): Promise<void> {
      const worktrees = await this.listWorktrees();

      for (const worktree of worktrees) {
        if (!worktree.isMain) {
          try {
            await this.removeWorktree(worktree.id);
          } catch (_error) {
            // Ignore cleanup errors
          }
        }
      }
    },
  };
}
