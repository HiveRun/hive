import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { Template } from "../config/schema";

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
  force?: boolean;
  templateId?: string;
};

export type WorktreeManager = {
  createWorktree(
    constructId: string,
    options?: WorktreeCreateOptions
  ): Promise<string>;
  removeWorktree(constructId: string): void;
};

export function createWorktreeManager(
  baseDir: string = process.cwd(),
  syntheticConfig?: { templates: Record<string, Template> }
): WorktreeManager {
  const constructsDir = join(homedir(), ".synthetic", "constructs");

  /**
   * Execute a git command and return output
   */
  function git(...args: string[]): string {
    return execSync(`git ${args.join(" ")}`, {
      encoding: "utf8",
      cwd: baseDir,
    }).trim();
  }

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
      return git("rev-parse", "--show-toplevel");
    } catch (_error) {
      // Fallback to baseDir if git command fails (e.g., in tests)
      return baseDir;
    }
  }

  /**
   * Get include patterns from synthetic config for a specific template
   * Falls back to default patterns if template not found or has no patterns
   */
  function getIncludePatterns(templateId?: string): string[] {
    if (!(templateId && syntheticConfig)) {
      return getDefaultIncludePatterns();
    }

    const template = syntheticConfig.templates[templateId] as
      | Template
      | undefined;
    if (!template?.includePatterns) {
      return getDefaultIncludePatterns();
    }

    return template.includePatterns;
  }

  /**
   * Get default include patterns for worktree copying
   * Only copy essential gitignored files like .env
   */
  function getDefaultIncludePatterns(): string[] {
    return [
      ".env*", // Environment files
      "*.local", // Local configuration files
    ];
  }

  /**
   * Check if a path should be included from worktree copy
   * Only copy files that match include patterns
   */
  function shouldIncludeFromCopy(
    path: string,
    includePatterns: string[]
  ): boolean {
    // Check if path matches any include pattern
    return includePatterns.some((pattern) => {
      if (pattern.includes("*")) {
        // Wildcard pattern - simple glob matching
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(path);
      }
      // Exact match
      return path === pattern;
    });
  }

  /**
   * List gitignored paths that match include patterns
   */
  function getIncludedPaths(
    mainRepoPath: string,
    includePatterns: string[]
  ): string[] {
    try {
      const output = execSync(
        "git ls-files --others --ignored --exclude-standard -z",
        {
          encoding: "utf8",
          cwd: mainRepoPath,
        }
      );

      if (!output) {
        return [];
      }

      return output
        .split("\0")
        .map((path) => path.trim())
        .filter((path) => path.length > 0)
        .filter((path) => shouldIncludeFromCopy(path, includePatterns));
    } catch {
      // Non-critical: If we can't list gitignored files, just don't copy them
      return [];
    }
  }

  /**
   * Copy a single file or directory to worktree
   */
  async function copyToWorktree(
    mainRepoPath: string,
    worktreePath: string,
    file: string
  ): Promise<void> {
    const sourcePath = join(mainRepoPath, file);
    const targetPath = join(worktreePath, file);

    try {
      const stat = statSync(sourcePath);

      if (stat.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
      } else {
        const targetDir = dirname(targetPath);
        await mkdir(targetDir, { recursive: true });
        await copyFile(sourcePath, targetPath);
      }
    } catch {
      // Non-critical: Files like .env are optional, ignore copy failures
    }
  }

  /**
   * Copy included gitignored files from main repo to worktree
   */
  async function copyIncludedFiles(
    worktreePath: string,
    includePatterns: string[]
  ): Promise<void> {
    const mainRepoPath = getMainRepoPath();
    const includedPaths = getIncludedPaths(mainRepoPath, includePatterns);

    for (const relativePath of includedPaths) {
      await copyToWorktree(mainRepoPath, worktreePath, relativePath);
    }
  }

  /**
   * Copy directory recursively
   */
  async function copyDirectory(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true });

    const entries = readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = join(source, entry.name);
      const targetPath = join(target, entry.name);

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
  function getCurrentBranch(): string {
    try {
      return git("rev-parse", "--abbrev-ref", "HEAD");
    } catch {
      // Fallback for non-git environments (tests, etc.)
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
        git("worktree", "remove", "--force", worktreePath);
      } catch {
        // Git command failed, try filesystem removal as fallback
        await rm(worktreePath, { recursive: true, force: true });
      }
    } else {
      throw new Error(`Worktree already exists at ${worktreePath}`);
    }
  }

  /**
   * Create unique branch for worktree
   */
  function ensureBranchExists(branchName: string): string {
    try {
      git("show-ref", "--verify", `refs/heads/${branchName}`);
      return branchName;
    } catch {
      const currentBranch = getCurrentBranch();
      git("branch", branchName, currentBranch);
      return branchName;
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

  /**
   * Find worktree info for a construct ID by listing all worktrees
   */
  function findWorktreeInfo(constructId: string): WorktreeInfo | null {
    try {
      const worktreeList = git("worktree", "list", "--porcelain");
      const mainRepoPath = getMainRepoPath();

      const sections = worktreeList.trim().split("\n\n");

      for (const section of sections) {
        const parsed = parseWorktreeSection(section);
        if (!parsed) {
          continue;
        }

        const isMain = parsed.path === mainRepoPath;
        const id = isMain ? "main" : extractConstructId(parsed.path);

        if (id === constructId) {
          return {
            id,
            path: parsed.path,
            branch: parsed.branch,
            commit: parsed.commit,
            isMain,
          };
        }
      }

      return null;
    } catch {
      // Fallback for non-git environments
      return null;
    }
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

      // Create unique branch
      const branch = ensureBranchExists(`construct-${constructId}`);

      try {
        // Create worktree
        git("worktree", "add", worktreePath, branch);

        // Copy included gitignored files using template-specific include patterns
        const includePatterns = getIncludePatterns(options.templateId);
        await copyIncludedFiles(worktreePath, includePatterns);

        return worktreePath;
      } catch (error) {
        // Clean up on failure
        if (existsSync(worktreePath)) {
          git("worktree", "remove", "--force", worktreePath);
        }
        throw error;
      }
    },

    /**
     * Remove a worktree (prune and delete)
     */
    removeWorktree(constructId: string): void {
      const worktreeInfo = findWorktreeInfo(constructId);

      if (!worktreeInfo) {
        throw new Error(`Worktree not found for construct ${constructId}`);
      }

      if (worktreeInfo.isMain) {
        throw new Error("Cannot remove the main worktree");
      }

      try {
        git("worktree", "remove", "--force", worktreeInfo.path);
        git("worktree", "prune");
      } catch (error) {
        throw new Error(
          `Failed to remove worktree for construct ${constructId}: ${error}`
        );
      }
    },
  };
}
