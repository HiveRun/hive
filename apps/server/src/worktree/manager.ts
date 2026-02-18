import type { ExecException } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, constants as fsConstants } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import {
  generateHiveToolConfig,
  HIVE_TOOL_SOURCE,
} from "../agents/hive-opencode-tool";
import { hiveConfigService } from "../config/context";
import type { HiveConfig, Template } from "../config/schema";

/**
 * Resolves the Hive server URL for tool configuration.
 * This URL is written to .hive/config.json in each worktree so tools
 * can communicate back to the Hive server.
 *
 * Uses HIVE_URL if set, otherwise constructs from PORT (defaulting to 3000).
 *
 * IMPORTANT: Uses "localhost" not "127.0.0.1" to handle IPv4/IPv6 binding.
 * The server may bind to IPv6 only, and "localhost" resolves correctly
 * for either protocol while "127.0.0.1" is IPv4-only.
 */
export function resolveHiveServerUrl(): string {
  if (process.env.HIVE_URL) {
    return process.env.HIVE_URL;
  }

  const port = process.env.PORT ?? "3000";
  const hostname = process.env.HOST ?? process.env.HOSTNAME ?? "localhost";
  const protocol = process.env.HIVE_PROTOCOL ?? "http";

  return `${protocol}://${hostname}:${port}`;
}

import { resolveCellsRoot } from "../workspaces/registry";

const WORKTREE_PREFIX = "worktree ";
const HEAD_PREFIX = "HEAD ";
const BRANCH_PREFIX = "branch ";
const REFS_HEADS_PREFIX = "refs/heads/";

const WORKTREE_PREFIX_LENGTH = WORKTREE_PREFIX.length;
const HEAD_PREFIX_LENGTH = HEAD_PREFIX.length;
const BRANCH_PREFIX_LENGTH = BRANCH_PREFIX.length;

const POSIX_SEPARATOR = "/";
const DEFAULT_IGNORE_PATTERNS: string[] = [];
const ALWAYS_IGNORED_INCLUDE_PATTERNS = [
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
];
const COPY_FAILURE_LOG_SAMPLE_SIZE = 3;
const COPY_CONCURRENCY = 32;
const INCLUDE_COPY_PROGRESS_EMIT_INTERVAL_MS = 500;
const INCLUDE_COPY_PROGRESS_EMIT_EVERY_FILES = 25;
const GLOB_MAGIC_PATTERN = /[*?{}[\]!]/;
const LEADING_DOT_SLASH_PATTERN = /^\.\//;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const RECURSIVE_GLOB_SUFFIX = "/**";
const RECURSIVE_GLOB_SUFFIX_LENGTH = RECURSIVE_GLOB_SUFFIX.length;
const DOT_GIT_SEGMENT = ".git";
const GLOBSTAR_PREFIX = "**/";
const COPYFILE_REFLINK_FORCE_MODE = fsConstants.COPYFILE_FICLONE_FORCE;
const REFLINK_UNSUPPORTED_ERROR_CODES = new Set([
  "ENOTSUP",
  "EOPNOTSUPP",
  "EXDEV",
  "EINVAL",
  "ENOSYS",
]);

type CopyOptions = NonNullable<Parameters<typeof cp>[2]>;
type CopyStrategy = "reflink" | "copy";

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
  onTimingEvent?: (event: WorktreeCreateTimingEvent) => void;
};

export type WorktreeCreateTimingEvent = {
  step: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export type WorktreeLocation = {
  path: string;
  branch: string;
  baseCommit: string;
};

export type WorktreeErrorKind =
  | "git"
  | "filesystem"
  | "conflict"
  | "not-found"
  | "cleanup"
  | "validation"
  | "unknown";

export type WorktreeManagerError = {
  kind: WorktreeErrorKind;
  message: string;
  context?: Record<string, unknown>;
  cause?: Error;
};

export function describeWorktreeError(error: WorktreeManagerError) {
  return {
    kind: error.kind,
    message: error.message,
    context: error.context,
    cause: error.cause?.message ?? null,
  };
}

export function worktreeErrorToError(error: WorktreeManagerError): Error {
  const contextSuffix = error.context
    ? ` ${JSON.stringify(error.context)}`
    : "";
  const formatted = new Error(`${error.message}${contextSuffix}`);
  if (error.cause) {
    (formatted as Error & { cause?: Error }).cause = error.cause;
  }
  return formatted;
}

function isWorktreeManagerError(value: unknown): value is WorktreeManagerError {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "message" in (value as Record<string, unknown>) &&
    "kind" in (value as Record<string, unknown>)
  );
}

function toWorktreeError(
  params: {
    message: string;
    kind?: WorktreeErrorKind;
    context?: Record<string, unknown>;
  },
  cause?: unknown
): WorktreeManagerError {
  if (isWorktreeManagerError(cause)) {
    const mergedContext =
      cause.context || params.context
        ? { ...(cause.context ?? {}), ...(params.context ?? {}) }
        : undefined;

    return {
      ...cause,
      kind: cause.kind ?? params.kind ?? "unknown",
      message: cause.message ?? params.message,
      context: mergedContext,
    };
  }

  let resolvedCause: Error | undefined;
  if (cause instanceof Error) {
    resolvedCause = cause;
  } else if (cause !== undefined) {
    resolvedCause = new Error(String(cause));
  }

  return {
    kind: params.kind ?? "unknown",
    message: params.message,
    context: params.context,
    cause: resolvedCause,
  };
}

export type WorktreeManager = {
  createWorktree(
    cellId: string,
    options?: WorktreeCreateOptions
  ): Promise<WorktreeLocation>;
  removeWorktree(cellId: string): Promise<void>;
};

export type AsyncWorktreeManager = {
  createWorktree(
    cellId: string,
    options?: WorktreeCreateOptions
  ): Promise<WorktreeLocation>;
  removeWorktree(cellId: string): Promise<void>;
};

export const toAsyncWorktreeManager = (
  manager: WorktreeManager
): AsyncWorktreeManager => ({
  createWorktree: (cellId, options) => manager.createWorktree(cellId, options),
  removeWorktree: (cellId) => manager.removeWorktree(cellId),
});

const DEFAULT_INCLUDE_PATTERNS: string[] = [];

export function createWorktreeManager(
  baseDir: string = process.cwd(),
  hiveConfig?: { templates: Record<string, Template> }
): WorktreeManager {
  const cellsDir = resolveCellsRoot();

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

  function logInfo(message: string, context?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== "test") {
      process.stderr.write(
        `[worktree] ${message}${context ? ` ${JSON.stringify(context)}` : ""}\n`
      );
    }
  }

  const reflinkDisabledByEnv =
    process.env.HIVE_WORKTREE_DISABLE_REFLINK === "1" ||
    process.env.HIVE_WORKTREE_COPY_MODE === "copy";
  let reflinkState: "unknown" | "supported" | "unsupported" =
    reflinkDisabledByEnv ? "unsupported" : "unknown";
  let reflinkFallbackLogged = false;

  const readErrorCode = (error: unknown): string | null => {
    if (!(error && typeof error === "object" && "code" in error)) {
      return null;
    }

    const raw = (error as { code?: unknown }).code;
    return typeof raw === "string" ? raw : null;
  };

  const isReflinkUnsupportedError = (error: unknown): boolean => {
    const code = readErrorCode(error);
    return code ? REFLINK_UNSUPPORTED_ERROR_CODES.has(code) : false;
  };

  const copyWithStrategy = async (args: {
    sourcePath: string;
    targetPath: string;
    options: CopyOptions;
  }): Promise<CopyStrategy> => {
    if (reflinkState !== "unsupported") {
      try {
        await cp(args.sourcePath, args.targetPath, {
          ...args.options,
          mode: COPYFILE_REFLINK_FORCE_MODE,
        });
        reflinkState = "supported";
        return "reflink";
      } catch (error) {
        if (!isReflinkUnsupportedError(error)) {
          throw error;
        }

        reflinkState = "unsupported";
        if (!reflinkFallbackLogged) {
          reflinkFallbackLogged = true;
          logInfo("Reflink unavailable, falling back to standard copy", {
            errorCode: readErrorCode(error),
          });
        }
      }
    }

    await cp(args.sourcePath, args.targetPath, args.options);
    return "copy";
  };

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
        stdio: "pipe",
      }).trim();
    } catch (error) {
      throw formatExecError(command, error);
    }
  }

  async function gitAsync(...args: string[]): Promise<string> {
    const child = Bun.spawn({
      cmd: ["git", ...args],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const exitCode = await child.exited;
    const stdout = (await stdoutPromise).trim();
    const stderr = (await stderrPromise).trim();

    if (exitCode !== 0) {
      const command = args.join(" ");
      const details = [stderr, stdout].filter(Boolean).join(" | ");
      throw new Error(
        [
          `Git command failed: git ${command}`,
          `exit code ${exitCode}`,
          details ? `DETAILS: ${details}` : undefined,
        ]
          .filter(Boolean)
          .join(" | ")
      );
    }

    return stdout;
  }

  async function ensureCellsDir(): Promise<void> {
    if (!existsSync(cellsDir)) {
      await mkdir(cellsDir, { recursive: true });
    }
  }

  function getMainRepoPath(): string {
    return git("rev-parse", "--show-toplevel");
  }

  function getIncludePatterns(templateId?: string): string[] {
    if (!(templateId && hiveConfig)) {
      return DEFAULT_INCLUDE_PATTERNS;
    }

    const template = hiveConfig.templates[templateId] as Template | undefined;
    if (!template?.includePatterns) {
      return DEFAULT_INCLUDE_PATTERNS;
    }

    return template.includePatterns;
  }

  function getIgnorePatterns(templateId?: string): string[] {
    const mergeWithAlwaysIgnored = (patterns: string[]) =>
      Array.from(new Set([...patterns, ...ALWAYS_IGNORED_INCLUDE_PATTERNS]));

    if (!(templateId && hiveConfig)) {
      return mergeWithAlwaysIgnored(DEFAULT_IGNORE_PATTERNS);
    }

    const template = hiveConfig.templates[templateId] as Template | undefined;
    if (!template?.ignorePatterns) {
      return mergeWithAlwaysIgnored(DEFAULT_IGNORE_PATTERNS);
    }

    return mergeWithAlwaysIgnored(template.ignorePatterns);
  }

  function normalizePattern(pattern: string): string {
    return pattern
      .split(sep)
      .join(POSIX_SEPARATOR)
      .replace(LEADING_DOT_SLASH_PATTERN, "")
      .replace(TRAILING_SLASHES_PATTERN, "");
  }

  function stripRecursiveGlobSuffix(pattern: string): string {
    return pattern
      .slice(0, -RECURSIVE_GLOB_SUFFIX_LENGTH)
      .replace(TRAILING_SLASHES_PATTERN, "");
  }

  function isDotGitIgnorePattern(pattern: string): boolean {
    return (
      pattern === DOT_GIT_SEGMENT ||
      pattern === `${DOT_GIT_SEGMENT}/**` ||
      pattern === `**/${DOT_GIT_SEGMENT}` ||
      pattern === `**/${DOT_GIT_SEGMENT}/**`
    );
  }

  function toStaticIgnorePrefix(pattern: string): string | null {
    const prefix = pattern.endsWith(RECURSIVE_GLOB_SUFFIX)
      ? stripRecursiveGlobSuffix(pattern)
      : pattern;

    if (!prefix || GLOB_MAGIC_PATTERN.test(prefix)) {
      return null;
    }

    return prefix;
  }

  function toAnyDepthIgnoreToken(pattern: string): string | null {
    if (
      !(
        pattern.startsWith(GLOBSTAR_PREFIX) &&
        pattern.endsWith(RECURSIVE_GLOB_SUFFIX)
      )
    ) {
      return null;
    }

    const token = stripRecursiveGlobSuffix(
      pattern.slice(GLOBSTAR_PREFIX.length)
    );
    if (
      !token ||
      token.includes(POSIX_SEPARATOR) ||
      GLOB_MAGIC_PATTERN.test(token)
    ) {
      return null;
    }

    return token;
  }

  function getStaticIncludeRoot(pattern: string): string | null {
    const normalized = normalizePattern(pattern);
    if (!normalized.endsWith(RECURSIVE_GLOB_SUFFIX)) {
      return null;
    }

    const root = stripRecursiveGlobSuffix(normalized);
    if (!root || GLOB_MAGIC_PATTERN.test(root)) {
      return null;
    }

    return root;
  }

  function partitionIncludePatterns(includePatterns: string[]): {
    staticRoots: string[];
    filePatterns: string[];
  } {
    const staticRoots = new Set<string>();
    const filePatterns: string[] = [];

    for (const pattern of includePatterns) {
      const root = getStaticIncludeRoot(pattern);
      if (root) {
        staticRoots.add(root);
      } else {
        filePatterns.push(pattern);
      }
    }

    return {
      staticRoots: Array.from(staticRoots),
      filePatterns,
    };
  }

  function hasDynamicIgnorePatterns(ignorePatterns: string[]): boolean {
    return ignorePatterns.some((pattern) => {
      const normalized = normalizePattern(pattern);
      if (!normalized || isDotGitIgnorePattern(normalized)) {
        return false;
      }
      return Boolean(normalized) && GLOB_MAGIC_PATTERN.test(normalized);
    });
  }

  function parseIgnoreMatcherConfig(ignorePatterns: string[]): {
    prefixPatterns: string[];
    anyDepthTokens: string[];
    ignoreDotGitAnywhere: boolean;
  } {
    const prefixPatterns = new Set<string>();
    const anyDepthTokens = new Set<string>();
    let ignoreDotGitAnywhere = false;

    for (const pattern of ignorePatterns) {
      const normalized = normalizePattern(pattern);
      if (isDotGitIgnorePattern(normalized)) {
        ignoreDotGitAnywhere = true;
        continue;
      }

      const token = toAnyDepthIgnoreToken(normalized);
      if (token) {
        anyDepthTokens.add(token);
        continue;
      }

      const prefix = toStaticIgnorePrefix(normalized);
      if (prefix) {
        prefixPatterns.add(prefix);
      }
    }

    return {
      prefixPatterns: Array.from(prefixPatterns),
      anyDepthTokens: Array.from(anyDepthTokens),
      ignoreDotGitAnywhere,
    };
  }

  function matchesIgnorePrefix(
    normalizedPath: string,
    prefixPatterns: string[]
  ): boolean {
    for (const prefix of prefixPatterns) {
      if (
        normalizedPath === prefix ||
        normalizedPath.startsWith(`${prefix}/`)
      ) {
        return true;
      }
    }

    return false;
  }

  function matchesAnyDepthIgnoreToken(
    normalizedPath: string,
    anyDepthTokens: string[]
  ): boolean {
    for (const token of anyDepthTokens) {
      if (
        normalizedPath === token ||
        normalizedPath.startsWith(`${token}/`) ||
        normalizedPath.endsWith(`/${token}`) ||
        normalizedPath.includes(`/${token}/`)
      ) {
        return true;
      }
    }

    return false;
  }

  function createIgnoreMatcher(ignorePatterns: string[]) {
    const config = parseIgnoreMatcherConfig(ignorePatterns);

    return (relativePath: string) => {
      const normalized = normalizePattern(relativePath);
      if (!normalized) {
        return false;
      }

      if (config.ignoreDotGitAnywhere) {
        const segments = normalized.split(POSIX_SEPARATOR);
        if (segments.includes(DOT_GIT_SEGMENT)) {
          return true;
        }
      }

      if (matchesAnyDepthIgnoreToken(normalized, config.anyDepthTokens)) {
        return true;
      }

      return matchesIgnorePrefix(normalized, config.prefixPatterns);
    };
  }

  async function getIncludedPaths(
    mainRepoPath: string,
    includePatterns: string[],
    ignorePatterns: string[]
  ): Promise<string[]> {
    if (includePatterns.length === 0) {
      return [];
    }

    const expandedPatterns = includePatterns.flatMap((pattern) => {
      if (!pattern.includes("/")) {
        return [pattern, `**/${pattern}`];
      }
      return [pattern];
    });

    try {
      const files = await listPathsWithGlobSubprocess({
        cwd: mainRepoPath,
        patterns: expandedPatterns,
        ignore: ignorePatterns,
      });

      return files.map((file) => file.split(sep).join(POSIX_SEPARATOR));
    } catch (error: unknown) {
      logWarn("Failed to match include patterns", error);
      return [];
    }
  }

  async function listPathsWithGlobSubprocess(args: {
    cwd: string;
    patterns: string[];
    ignore: string[];
  }): Promise<string[]> {
    const script =
      "import { glob } from 'tinyglobby';" +
      "const cwd = process.env.HIVE_GLOB_CWD;" +
      "const patternsJson = process.env.HIVE_GLOB_PATTERNS_JSON;" +
      "const ignoreJson = process.env.HIVE_GLOB_IGNORE_JSON;" +
      "if (!cwd || !patternsJson || !ignoreJson) { throw new Error('Missing glob subprocess input'); }" +
      "const patterns = JSON.parse(patternsJson);" +
      "const ignore = JSON.parse(ignoreJson);" +
      "const files = await glob(patterns, { cwd, absolute: false, ignore, dot: true, onlyFiles: false });" +
      "process.stdout.write(JSON.stringify(files));";

    const bunExecutable = process.env.HIVE_BUN_BIN ?? Bun.which("bun");

    if (!bunExecutable) {
      return await listPathsWithGlobInProcess(args);
    }

    const child = Bun.spawn({
      cmd: [bunExecutable, "-e", script],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HIVE_GLOB_CWD: args.cwd,
        HIVE_GLOB_PATTERNS_JSON: JSON.stringify(args.patterns),
        HIVE_GLOB_IGNORE_JSON: JSON.stringify(args.ignore),
      },
    });

    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const exitCode = await child.exited;
    const stdout = await stdoutPromise;
    const stderr = await stderrPromise;

    if (exitCode !== 0) {
      logWarn(
        "Glob subprocess failed, falling back to in-process matching",
        stderr.trim() || `exit code ${exitCode}`
      );
      return await listPathsWithGlobInProcess(args);
    }

    if (!stdout.trim()) {
      return [];
    }

    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Glob subprocess returned invalid payload");
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  }

  async function listPathsWithGlobInProcess(args: {
    cwd: string;
    patterns: string[];
    ignore: string[];
  }): Promise<string[]> {
    return await glob(args.patterns, {
      cwd: args.cwd,
      absolute: false,
      ignore: args.ignore,
      dot: true,
      onlyFiles: false,
    });
  }

  async function copyIncludedRoot(
    mainRepoPath: string,
    worktreePath: string,
    root: string,
    shouldIgnore: (relativePath: string) => boolean
  ): Promise<CopyStrategy | null> {
    const sourcePath = join(mainRepoPath, root);
    if (!existsSync(sourcePath)) {
      return null;
    }

    const targetPath = join(worktreePath, root);

    try {
      await mkdir(dirname(targetPath), { recursive: true });
      return await copyWithStrategy({
        sourcePath,
        targetPath,
        options: {
          recursive: true,
          filter: (source) => {
            const rel = normalizePattern(relative(mainRepoPath, source));
            if (!rel || rel === ".") {
              return true;
            }

            return !shouldIgnore(rel);
          },
        },
      });
    } catch {
      return null;
    }
  }

  function isUnderCopiedRoot(path: string, copiedRoots: string[]): boolean {
    for (const root of copiedRoots) {
      if (path === root || path.startsWith(`${root}/`)) {
        return true;
      }
    }

    return false;
  }

  function incrementCopyStrategyCounts(
    strategy: CopyStrategy,
    counters: {
      reflinkCopiedPathCount: number;
      standardCopiedPathCount: number;
    }
  ): void {
    if (strategy === "reflink") {
      counters.reflinkCopiedPathCount += 1;
      return;
    }

    counters.standardCopiedPathCount += 1;
  }

  function logCopyFailures(failedPaths: string[]): void {
    if (failedPaths.length === 0) {
      return;
    }

    const sample = failedPaths
      .slice(0, COPY_FAILURE_LOG_SAMPLE_SIZE)
      .join(", ");
    const suffix =
      failedPaths.length > COPY_FAILURE_LOG_SAMPLE_SIZE ? ", ..." : "";
    logWarn(
      `Failed to copy ${failedPaths.length} included path(s) to worktree`,
      `${sample}${suffix}`
    );
  }

  async function copyIncludedFiles(
    worktreePath: string,
    includePatterns: string[],
    ignorePatterns: string[],
    onTimingEvent?: (event: WorktreeCreateTimingEvent) => void
  ): Promise<{
    copiedPathCount: number;
    copiedRootCount: number;
    copiedFileCount: number;
    reflinkCopiedPathCount: number;
    standardCopiedPathCount: number;
    reflinkEnabled: boolean;
    globMatchDurationMs: number;
    staticRootCopyDurationMs: number;
    fileCopyDurationMs: number;
  }> {
    if (includePatterns.length === 0) {
      return {
        copiedPathCount: 0,
        copiedRootCount: 0,
        copiedFileCount: 0,
        reflinkCopiedPathCount: 0,
        standardCopiedPathCount: 0,
        reflinkEnabled: reflinkState !== "unsupported",
        globMatchDurationMs: 0,
        staticRootCopyDurationMs: 0,
        fileCopyDurationMs: 0,
      };
    }

    const mainRepoPath = getMainRepoPath();
    const partitioned = partitionIncludePatterns(includePatterns);
    const useStaticRootCopy = !hasDynamicIgnorePatterns(ignorePatterns);
    const staticRoots = useStaticRootCopy ? partitioned.staticRoots : [];
    const filePatterns = useStaticRootCopy
      ? [...partitioned.filePatterns]
      : [...includePatterns];
    const shouldIgnore = createIgnoreMatcher(ignorePatterns);
    const copiedRoots: string[] = [];
    const failedPaths: string[] = [];
    const copyCounters = {
      reflinkCopiedPathCount: 0,
      standardCopiedPathCount: 0,
    };
    let copiedFileCount = 0;
    let staticRootCopyDurationMs = 0;

    for (const root of staticRoots) {
      const rootCopyStartedAt = Date.now();
      const strategy = await copyIncludedRoot(
        mainRepoPath,
        worktreePath,
        root,
        shouldIgnore
      );
      staticRootCopyDurationMs += Date.now() - rootCopyStartedAt;
      if (strategy) {
        copiedRoots.push(root);
        incrementCopyStrategyCounts(strategy, copyCounters);
      } else {
        failedPaths.push(`${root}/**`);
        filePatterns.push(`${root}/**`);
      }
    }

    const globMatchStartedAt = Date.now();
    onTimingEvent?.({
      step: "include_copy_glob_match_start",
      durationMs: 0,
      metadata: {
        includePatternCount: includePatterns.length,
      },
    });
    const includedPaths = await getIncludedPaths(
      mainRepoPath,
      filePatterns,
      ignorePatterns
    );
    const globMatchDurationMs = Date.now() - globMatchStartedAt;
    onTimingEvent?.({
      step: "include_copy_glob_match_complete",
      durationMs: globMatchDurationMs,
      metadata: {
        includePatternCount: includePatterns.length,
        matchedPathCount: includedPaths.length,
      },
    });
    const pendingPaths = includedPaths.filter(
      (relativePath) => !isUnderCopiedRoot(relativePath, copiedRoots)
    );

    const ensuredDirs = new Set<string>();
    let nextIndex = 0;
    let lastProgressCopiedFileCount = 0;
    let lastProgressEventElapsedMs = 0;

    const fileCopyStartedAt = Date.now();
    onTimingEvent?.({
      step: "include_copy_files_start",
      durationMs: 0,
      metadata: {
        pendingPathCount: pendingPaths.length,
      },
    });
    const emitFileCopyProgress = () => {
      if (pendingPaths.length === 0) {
        return;
      }

      const elapsedMs = Date.now() - fileCopyStartedAt;
      const copiedSinceLastEvent =
        copiedFileCount - lastProgressCopiedFileCount;
      const shouldEmitByCount =
        copiedSinceLastEvent >= INCLUDE_COPY_PROGRESS_EMIT_EVERY_FILES;
      const shouldEmitByTime =
        elapsedMs - lastProgressEventElapsedMs >=
        INCLUDE_COPY_PROGRESS_EMIT_INTERVAL_MS;
      const isComplete = copiedFileCount === pendingPaths.length;

      if (!(shouldEmitByCount || shouldEmitByTime || isComplete)) {
        return;
      }

      lastProgressCopiedFileCount = copiedFileCount;
      lastProgressEventElapsedMs = elapsedMs;

      onTimingEvent?.({
        step: "include_copy_files_progress",
        durationMs: elapsedMs,
        metadata: {
          copiedFileCount,
          pendingPathCount: pendingPaths.length,
        },
      });
    };

    const worker = async () => {
      while (nextIndex < pendingPaths.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        const relativePath = pendingPaths[currentIndex];
        if (!relativePath) {
          continue;
        }

        const strategy = await copyToWorktree(
          mainRepoPath,
          worktreePath,
          relativePath,
          ensuredDirs
        );
        if (!strategy) {
          failedPaths.push(relativePath);
          continue;
        }

        copiedFileCount += 1;
        incrementCopyStrategyCounts(strategy, copyCounters);
        emitFileCopyProgress();
      }
    };

    const workerCount = Math.max(
      1,
      Math.min(COPY_CONCURRENCY, pendingPaths.length)
    );
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const fileCopyDurationMs = Date.now() - fileCopyStartedAt;
    onTimingEvent?.({
      step: "include_copy_files_complete",
      durationMs: fileCopyDurationMs,
      metadata: {
        copiedFileCount,
        pendingPathCount: pendingPaths.length,
      },
    });

    logCopyFailures(failedPaths);

    return {
      copiedPathCount: copiedRoots.length + copiedFileCount,
      copiedRootCount: copiedRoots.length,
      copiedFileCount,
      reflinkCopiedPathCount: copyCounters.reflinkCopiedPathCount,
      standardCopiedPathCount: copyCounters.standardCopiedPathCount,
      reflinkEnabled: reflinkState !== "unsupported",
      globMatchDurationMs,
      staticRootCopyDurationMs,
      fileCopyDurationMs,
    };
  }

  async function copyToWorktree(
    mainRepoPath: string,
    worktreePath: string,
    file: string,
    ensuredDirs: Set<string>
  ): Promise<CopyStrategy | null> {
    const sourcePath = join(mainRepoPath, file);
    const targetPath = join(worktreePath, file);
    const targetDir = dirname(targetPath);

    try {
      if (!ensuredDirs.has(targetDir)) {
        await mkdir(targetDir, { recursive: true });
        ensuredDirs.add(targetDir);
      }
      return await copyWithStrategy({
        sourcePath,
        targetPath,
        options: { recursive: true },
      });
    } catch {
      return null;
    }
  }

  async function ensureHiveToolAndConfig(
    worktreePath: string,
    cellId: string
  ): Promise<void> {
    const hiveUrl = resolveHiveServerUrl();

    // Write .opencode/tools/hive.ts (the tool source)
    const toolDir = join(worktreePath, ".opencode", "tools");
    const toolPath = join(toolDir, "hive.ts");

    try {
      await mkdir(toolDir, { recursive: true });
      await writeFile(toolPath, HIVE_TOOL_SOURCE, "utf8");
    } catch (error: unknown) {
      logWarn("Failed to write Hive tool for worktree", error);
    }

    // Write .hive/config.json (tool configuration)
    const hiveDir = join(worktreePath, ".hive");
    const configPath = join(hiveDir, "config.json");
    const configContent = generateHiveToolConfig({ cellId, hiveUrl });

    try {
      await mkdir(hiveDir, { recursive: true });
      await writeFile(configPath, configContent, "utf8");
    } catch (error: unknown) {
      logWarn("Failed to write Hive config for worktree", error);
    }
  }

  function getCurrentBranch(): string {
    return git("rev-parse", "--abbrev-ref", "HEAD");
  }

  const handleExistingWorktree = async (
    worktreePath: string,
    force: boolean
  ): Promise<void> => {
    if (!existsSync(worktreePath)) {
      return;
    }

    if (!force) {
      throw toWorktreeError(
        {
          message: `Worktree already exists at ${worktreePath}`,
          kind: "conflict",
          context: { worktreePath },
        },
        undefined
      );
    }

    try {
      try {
        git("worktree", "remove", "--force", worktreePath);
      } catch (error) {
        logWarn(
          "Git worktree remove failed, falling back to filesystem removal",
          error
        );
        await rm(worktreePath, { recursive: true, force: true });
      }
    } catch (cause) {
      throw toWorktreeError(
        {
          message: "Failed to clean up existing worktree",
          kind: "cleanup",
          context: { worktreePath },
        },
        cause
      );
    }
  };

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

  function findWorktreeInfo(cellId: string): WorktreeInfo | null {
    const expectedPath = join(cellsDir, cellId);
    const worktreeList = git("worktree", "list", "--porcelain");
    const sections = worktreeList.trim().split("\n\n");

    for (const section of sections) {
      const parsed = parseWorktreeSection(section);
      if (!parsed) {
        continue;
      }

      if (parsed.path === expectedPath) {
        return {
          id: cellId,
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
      cellId: string,
      options: WorktreeCreateOptions = {}
    ): Promise<WorktreeLocation> {
      const worktreePath = join(cellsDir, cellId);

      try {
        await ensureCellsDir();
      } catch (cause) {
        throw toWorktreeError(
          {
            message: "Failed to prepare cells directory",
            kind: "filesystem",
            context: { worktreePath },
          },
          cause
        );
      }

      await handleExistingWorktree(worktreePath, options.force ?? false);

      const branch = ensureBranchExists(`cell-${cellId}`);

      try {
        const emitTiming = (event: WorktreeCreateTimingEvent) => {
          options.onTimingEvent?.(event);
        };

        const worktreeAddStartedAt = Date.now();
        git("worktree", "add", worktreePath, branch);
        const worktreeAddDurationMs = Date.now() - worktreeAddStartedAt;
        emitTiming({
          step: "git_worktree_add",
          durationMs: worktreeAddDurationMs,
          metadata: {
            branch,
          },
        });

        const includePatterns = getIncludePatterns(options.templateId);
        const ignorePatterns = getIgnorePatterns(options.templateId);
        const includeCopyStartedAt = Date.now();
        const includeCopySummary = await copyIncludedFiles(
          worktreePath,
          includePatterns,
          ignorePatterns,
          emitTiming
        );
        const includeCopyDurationMs = Date.now() - includeCopyStartedAt;
        emitTiming({
          step: "include_copy_glob_match",
          durationMs: includeCopySummary.globMatchDurationMs,
          metadata: {
            includePatternCount: includePatterns.length,
          },
        });
        emitTiming({
          step: "include_copy_static_roots",
          durationMs: includeCopySummary.staticRootCopyDurationMs,
          metadata: {
            copiedRootCount: includeCopySummary.copiedRootCount,
          },
        });
        emitTiming({
          step: "include_copy_files",
          durationMs: includeCopySummary.fileCopyDurationMs,
          metadata: {
            copiedFileCount: includeCopySummary.copiedFileCount,
          },
        });
        emitTiming({
          step: "include_copy",
          durationMs: includeCopyDurationMs,
          metadata: {
            copiedPathCount: includeCopySummary.copiedPathCount,
            copiedRootCount: includeCopySummary.copiedRootCount,
            copiedFileCount: includeCopySummary.copiedFileCount,
            reflinkCopiedPathCount: includeCopySummary.reflinkCopiedPathCount,
            standardCopiedPathCount: includeCopySummary.standardCopiedPathCount,
            reflinkEnabled: includeCopySummary.reflinkEnabled,
            includePatternCount: includePatterns.length,
            ignorePatternCount: ignorePatterns.length,
          },
        });

        const ensureHiveToolStartedAt = Date.now();
        await ensureHiveToolAndConfig(worktreePath, cellId);
        emitTiming({
          step: "ensure_hive_tool_config",
          durationMs: Date.now() - ensureHiveToolStartedAt,
        });

        const baseCommitStartedAt = Date.now();
        const baseCommit = git("rev-parse", branch);
        const baseCommitDurationMs = Date.now() - baseCommitStartedAt;
        emitTiming({
          step: "resolve_base_commit",
          durationMs: baseCommitDurationMs,
          metadata: {
            branch,
          },
        });
        logInfo("Worktree create completed", {
          cellId,
          templateId: options.templateId ?? null,
          worktreePath,
          branch,
          worktreeAddDurationMs,
          includeCopyDurationMs,
          copiedPathCount: includeCopySummary.copiedPathCount,
          copiedRootCount: includeCopySummary.copiedRootCount,
          copiedFileCount: includeCopySummary.copiedFileCount,
          reflinkCopiedPathCount: includeCopySummary.reflinkCopiedPathCount,
          standardCopiedPathCount: includeCopySummary.standardCopiedPathCount,
          reflinkEnabled: includeCopySummary.reflinkEnabled,
          baseCommitDurationMs,
        });
        return {
          path: worktreePath,
          branch,
          baseCommit,
        } satisfies WorktreeLocation;
      } catch (cause) {
        try {
          if (existsSync(worktreePath)) {
            git("worktree", "remove", "--force", worktreePath);
          }
        } catch (cleanupError: unknown) {
          logWarn("Failed to cleanup worktree after failure", cleanupError);
        }

        throw toWorktreeError(
          {
            message: "Failed to create git worktree",
            kind: "git",
            context: {
              cellId,
              worktreePath,
              templateId: options.templateId,
            },
          },
          cause
        );
      }
    },

    async removeWorktree(cellId: string): Promise<void> {
      const worktreeInfo = findWorktreeInfo(cellId);

      if (!worktreeInfo) {
        throw toWorktreeError(
          {
            message: `Worktree not found for cell ${cellId}`,
            kind: "not-found",
            context: { cellId },
          },
          undefined
        );
      }

      if (worktreeInfo.isMain) {
        throw toWorktreeError(
          {
            message: "Cannot remove the main worktree",
            kind: "validation",
            context: { cellId },
          },
          undefined
        );
      }

      try {
        await gitAsync("worktree", "remove", "--force", worktreeInfo.path);
        await gitAsync("worktree", "prune");
        return;
      } catch (cause) {
        throw toWorktreeError(
          {
            message: "Failed to remove git worktree",
            kind: "cleanup",
            context: { cellId, worktreePath: worktreeInfo.path },
          },
          cause
        );
      }
    },
  };
}

export type WorktreeManagerInitError = {
  readonly _tag: "WorktreeManagerInitError";
  readonly workspacePath: string;
  readonly cause: unknown;
};

const makeWorktreeManagerInitError = (
  workspacePath: string,
  cause: unknown
): WorktreeManagerInitError => ({
  _tag: "WorktreeManagerInitError",
  workspacePath,
  cause,
});

const toManagerPromise = (
  workspacePath: string,
  config?: HiveConfig
): Promise<WorktreeManager> => {
  try {
    return Promise.resolve(createWorktreeManager(workspacePath, config));
  } catch (cause) {
    return Promise.reject(makeWorktreeManagerInitError(workspacePath, cause));
  }
};

export type WorktreeManagerService = {
  readonly createManager: (
    workspacePath: string,
    config?: HiveConfig
  ) => Promise<WorktreeManager>;
  readonly createWorktree: (
    args: {
      workspacePath: string;
      cellId: string;
    } & WorktreeCreateOptions
  ) => Promise<WorktreeLocation>;
  readonly removeWorktree: (
    workspacePath: string,
    cellId: string
  ) => Promise<void>;
};

type HiveConfigServiceInstance = {
  load: (workspaceRoot?: string) => Promise<HiveConfig>;
};

const makeWorktreeManagerService = (
  configService: HiveConfigServiceInstance
): WorktreeManagerService => {
  const loadConfig = async (workspacePath: string) => {
    try {
      return await configService.load(workspacePath);
    } catch (cause) {
      throw makeWorktreeManagerInitError(workspacePath, cause);
    }
  };

  const managerFor = (
    workspacePath: string,
    config?: HiveConfig
  ): Promise<WorktreeManager> =>
    config
      ? toManagerPromise(workspacePath, config)
      : loadConfig(workspacePath).then((loadedConfig) =>
          toManagerPromise(workspacePath, loadedConfig)
        );

  return {
    createManager: managerFor,
    createWorktree: async (args) => {
      const { workspacePath, cellId, ...options } = args;
      const manager = await managerFor(workspacePath);
      return await manager.createWorktree(cellId, options);
    },
    removeWorktree: async (workspacePath, cellId) => {
      const manager = await managerFor(workspacePath);
      await manager.removeWorktree(cellId);
    },
  };
};

export const worktreeManagerService =
  makeWorktreeManagerService(hiveConfigService);
