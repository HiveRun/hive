import { execSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
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
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".synthetic",
  ".turbo",
]);

type DirectoryFrame = {
  absPath: string;
  relativePath: string;
};

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
   * Find paths that match include patterns recursively
   */
  function getIncludedPaths(
    mainRepoPath: string,
    includePatterns: string[]
  ): string[] {
    if (includePatterns.length === 0) {
      return [];
    }

    const includedPaths = new Set<string>();
    const matchers = includePatterns.map(createPatternMatcher);

    function shouldInclude(path: string, basename: string): boolean {
      return matchers.some((matcher) => matcher(path, basename));
    }

    walkRepository(mainRepoPath, (relativePath, basename) => {
      const normalizedPath = toPosixPath(relativePath);
      if (shouldInclude(normalizedPath, basename)) {
        includedPaths.add(normalizedPath);
      }
    });

    return Array.from(includedPaths);
  }

  function walkRepository(
    rootPath: string,
    visitFile: (relativePath: string, basename: string) => void
  ): void {
    const stack: DirectoryFrame[] = [{ absPath: rootPath, relativePath: "" }];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) {
        continue;
      }

      processDirectoryFrame(frame, stack, visitFile);
    }
  }

  function processDirectoryFrame(
    frame: DirectoryFrame,
    stack: DirectoryFrame[],
    visitFile: (relativePath: string, basename: string) => void
  ): void {
    const entries = readDirectoryEntries(frame.absPath);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryRelativePath = frame.relativePath
        ? join(frame.relativePath, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        stack.push({
          absPath: join(frame.absPath, entry.name),
          relativePath: entryRelativePath,
        });
        continue;
      }

      visitFile(entryRelativePath, entry.name);
    }
  }

  function readDirectoryEntries(dirPath: string): Dirent[] | null {
    try {
      return readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      logWarn(`Failed to read directory ${dirPath}`, error);
      return null;
    }
  }

  function createPatternMatcher(
    pattern: string
  ): (path: string, basename: string) => boolean {
    const normalizedPattern = toPosixPath(pattern);
    const isBasenamePattern = !normalizedPattern.includes(POSIX_SEPARATOR);
    const regex = globToRegex(normalizedPattern);

    if (isBasenamePattern) {
      return (_path, basename) => regex.test(basename);
    }

    return (path) => regex.test(path);
  }

  function globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&")
      .replace(/\*\*/g, "§§DOUBLESTAR§§")
      .replace(/\*/g, "[^/]*")
      .replace(/§§DOUBLESTAR§§/g, ".*");

    return new RegExp(`^${escaped}$`);
  }

  function toPosixPath(value: string): string {
    return value.split(sep).join(POSIX_SEPARATOR);
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
    } catch (error) {
      logWarn(`Failed to copy ${file} to worktree`, error);
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
