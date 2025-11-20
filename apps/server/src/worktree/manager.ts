import type { ExecException } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { glob } from "tinyglobby";
import type { Template } from "../config/schema";
import { resolveConstructsRoot } from "../workspaces/registry";

const WORKTREE_PREFIX = "worktree ";
const HEAD_PREFIX = "HEAD ";
const BRANCH_PREFIX = "branch ";
const REFS_HEADS_PREFIX = "refs/heads/";

const WORKTREE_PREFIX_LENGTH = WORKTREE_PREFIX.length;
const HEAD_PREFIX_LENGTH = HEAD_PREFIX.length;
const BRANCH_PREFIX_LENGTH = BRANCH_PREFIX.length;

const POSIX_SEPARATOR = "/";
const IGNORED_DIRECTORIES = [
  ".git",
  "node_modules",
  ".synthetic",
  ".turbo",
  "vendor",
];

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

export type WorktreeLocation = {
  path: string;
  branch: string;
  baseCommit: string;
};

export type WorktreeManager = {
  createWorktree(
    constructId: string,
    options?: WorktreeCreateOptions
  ): Promise<WorktreeLocation>;
  removeWorktree(constructId: string): void;
};

const DEFAULT_INCLUDE_PATTERNS: string[] = [];

export function createWorktreeManager(
  baseDir: string = process.cwd(),
  syntheticConfig?: { templates: Record<string, Template> }
): WorktreeManager {
  const constructsDir = resolveConstructsRoot();

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

  ensureGitRepo();

  function logWarn(message: string, error?: unknown): void {
    if (process.env.NODE_ENV !== "test") {
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[worktree] ${message}: ${errorMsg}\n`);
    }
  }

  type ExecError = ExecException & {
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };

  function formatExecError(command: string, error: unknown): Error {
    if (error && typeof error === "object") {
      const execError = error as ExecError;
      const stderr = execError.stderr
        ? execError.stderr.toString().trim()
        : undefined;
      const stdout = execError.stdout
        ? execError.stdout.toString().trim()
        : undefined;
      const baseMessage = execError.message ?? String(error);
      const details = [stderr, stdout].filter(Boolean).join(" | ");
      return new Error(
        [
          `Git command failed: git ${command}`,
          baseMessage,
          details ? `DETAILS: ${details}` : undefined,
        ]
          .filter(Boolean)
          .join(" | ")
      );
    }
    return new Error(`Git command failed: git ${command} | ${String(error)}`);
  }

  function git(...args: string[]): string {
    const command = args.join(" ");
    try {
      return execSync(`git ${command}`, {
        encoding: "utf8",
        cwd: baseDir,
      }).trim();
    } catch (error) {
      throw formatExecError(command, error);
    }
  }

  async function ensureConstructsDir(): Promise<void> {
    if (!existsSync(constructsDir)) {
      await mkdir(constructsDir, { recursive: true });
    }
  }

  function getMainRepoPath(): string {
    return git("rev-parse", "--show-toplevel");
  }

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
        if (!pattern.includes("/")) {
          return [pattern, `**/${pattern}`];
        }
        return [pattern];
      });

      const files = await glob(expandedPatterns, {
        cwd: mainRepoPath,
        absolute: false,
        ignore: IGNORED_DIRECTORIES.map((dir) => `**/${dir}/**`),
        dot: true,
      });

      return files.map((file: string) => file.split(sep).join(POSIX_SEPARATOR));
    } catch (error) {
      logWarn("Failed to match include patterns", error);
      return [];
    }
  }

  async function copyIncludedFiles(
    worktreePath: string,
    includePatterns: string[]
  ): Promise<void> {
    if (includePatterns.length === 0) {
      return;
    }

    const mainRepoPath = getMainRepoPath();
    const includedPaths = await getIncludedPaths(mainRepoPath, includePatterns);

    for (const relativePath of includedPaths) {
      await copyToWorktree(mainRepoPath, worktreePath, relativePath);
    }
  }

  async function copyToWorktree(
    mainRepoPath: string,
    worktreePath: string,
    file: string
  ): Promise<void> {
    const sourcePath = join(mainRepoPath, file);
    const targetPath = join(worktreePath, file);

    try {
      await cp(sourcePath, targetPath, { recursive: true });
    } catch (error) {
      logWarn(`Failed to copy ${file} to worktree`, error);
    }
  }

  function getCurrentBranch(): string {
    return git("rev-parse", "--abbrev-ref", "HEAD");
  }

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

  function findWorktreeInfo(constructId: string): WorktreeInfo | null {
    const expectedPath = join(constructsDir, constructId);
    const worktreeList = git("worktree", "list", "--porcelain");
    const sections = worktreeList.trim().split("\n\n");

    for (const section of sections) {
      const parsed = parseWorktreeSection(section);
      if (!parsed) {
        continue;
      }

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
    async createWorktree(
      constructId: string,
      options: WorktreeCreateOptions = {}
    ): Promise<WorktreeLocation> {
      await ensureConstructsDir();

      const worktreePath = join(constructsDir, constructId);

      await handleExistingWorktree(worktreePath, options.force ?? false);

      const branch = ensureBranchExists(`construct-${constructId}`);

      try {
        git("worktree", "add", worktreePath, branch);

        const includePatterns = getIncludePatterns(options.templateId);
        await copyIncludedFiles(worktreePath, includePatterns);

        const baseCommit = git("rev-parse", branch);
        return {
          path: worktreePath,
          branch,
          baseCommit,
        };
      } catch (error) {
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
