import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { glob } from "tinyglobby";
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

const POSIX_SEPARATOR = "/";
const IGNORED_DIRECTORIES = [".git", "node_modules", ".synthetic", ".turbo"];

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

const DEFAULT_INCLUDE_PATTERNS = [
  ".env*", // Environment files
  "*.local", // Local configuration files
];

export function createWorktreeManager(
  baseDir: string = process.cwd(),
  syntheticConfig?: { templates: Record<string, Template> }
): WorktreeManager {
  const constructsDir = join(homedir(), ".synthetic", "constructs");

  /**
   * Verify we're in a git repository
   */
  function ensureGitRepo(): void {
    try {
      execSync("git rev-parse --git-dir", {
        encoding: "utf8",
        cwd: baseDir,
        stdio: "pipe",
      });
    } catch {
      throw new Error(
        `Not a git repository: ${baseDir}. Worktree manager requires a git repository.`
      );
    }
  }

  // Fail fast if not in a git repo
  ensureGitRepo();

  /**
   * Internal logger for non-critical warnings
   * Uses stderr to avoid polluting stdout, respects NODE_ENV
   */
  function logWarn(message: string, error?: unknown): void {
    if (process.env.NODE_ENV !== "test") {
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[worktree] ${message}: ${errorMsg}\n`);
    }
  }

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
    return git("rev-parse", "--show-toplevel");
  }

  /**
   * Get include patterns from synthetic config for a specific template
   * Falls back to default patterns if template not found or has no patterns
   */
  function getIncludePatterns(templateId?: string): string[] {
    if (!(templateId && syntheticConfig)) {
      return DEFAULT_INCLUDE_PATTERNS;
    }

    const template = syntheticConfig.templates[templateId] as
      | Template
      | undefined;
    if (!template?.includePatterns) {
      return DEFAULT_INCLUDE_PATTERNS;
    }

    return template.includePatterns;
  }

  /**
   * Find paths that match include patterns recursively using tinyglobby
   */
  async function getIncludedPaths(
    mainRepoPath: string,
    includePatterns: string[]
  ): Promise<string[]> {
    if (includePatterns.length === 0) {
      return [];
    }

    try {
      // Expand patterns to include recursive matching for nested files
      const expandedPatterns = includePatterns.flatMap((pattern) => {
        // If pattern doesn't contain a path separator, add both root and recursive versions
        if (!pattern.includes("/")) {
          return [pattern, `**/${pattern}`];
        }
        return [pattern];
      });

      const files = await glob(expandedPatterns, {
        cwd: mainRepoPath,
        absolute: false,
        ignore: IGNORED_DIRECTORIES.map((dir) => `**/${dir}/**`),
        dot: true, // Include dot files like .env
      });

      // Convert to POSIX paths for consistency
      return files.map((file: string) => file.split(sep).join(POSIX_SEPARATOR));
    } catch (error) {
      logWarn("Failed to match include patterns", error);
      return [];
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
    const includedPaths = await getIncludedPaths(mainRepoPath, includePatterns);

    for (const relativePath of includedPaths) {
      await copyToWorktree(mainRepoPath, worktreePath, relativePath);
    }
  }

  /**
   * Copy a single file or directory to worktree using Node.js built-in cp
   */
  async function copyToWorktree(
    mainRepoPath: string,
    worktreePath: string,
    file: string
  ): Promise<void> {
    const sourcePath = join(mainRepoPath, file);
    const targetPath = join(worktreePath, file);

    try {
      // Use Node.js built-in cp for recursive copying
      await cp(sourcePath, targetPath, { recursive: true });
    } catch (error) {
      logWarn(`Failed to copy ${file} to worktree`, error);
    }
  }

  /**
   * Get the current branch name
   */
  function getCurrentBranch(): string {
    return git("rev-parse", "--abbrev-ref", "HEAD");
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
      } catch (error) {
        logWarn(
          "Git worktree remove failed, falling back to filesystem removal",
          error
        );
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
   * Find worktree info for a construct ID by checking expected path
   */
  function findWorktreeInfo(constructId: string): WorktreeInfo | null {
    const expectedPath = join(constructsDir, constructId);
    const worktreeList = git("worktree", "list", "--porcelain");
    const sections = worktreeList.trim().split("\n\n");

    for (const section of sections) {
      const parsed = parseWorktreeSection(section);
      if (!parsed) {
        continue;
      }

      // Match by expected path
      if (parsed.path === expectedPath) {
        return {
          id: constructId,
          path: parsed.path,
          branch: parsed.branch,
          commit: parsed.commit,
          isMain: false,
        };
      }
    }

    return null;
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
        try {
          if (existsSync(worktreePath)) {
            git("worktree", "remove", "--force", worktreePath);
          }
        } catch (cleanupError) {
          logWarn("Failed to cleanup worktree after failure", cleanupError);
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
