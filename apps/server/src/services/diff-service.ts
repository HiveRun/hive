import { join } from "node:path";

export type DiffMode = "workspace" | "branch";
export type DiffStatus = "modified" | "added" | "deleted";

export type DiffFileSummary = {
  path: string;
  status: DiffStatus;
  additions: number;
  deletions: number;
};

export type DiffFileDetail = DiffFileSummary & {
  beforeContent?: string;
  afterContent?: string;
  patch?: string;
};

const WORKSPACE_REF = "HEAD";
const UNTRACKED_EXCLUDES = ["--others", "--exclude-standard"];
const MIN_NUMSTAT_SEGMENTS = 3;
const PATCH_CONTEXT_ARG = "--unified=200";

type StatsMap = Map<string, { additions: number; deletions: number }>;
type StatusMap = Map<string, DiffStatus>;

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  const exitCode = await child.exited;
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`
    );
  }

  return {
    stdout: stdout.trimEnd(),
    stderr: stderr.trimEnd(),
  };
}

function normalizeNumstatPath(rawPath: string): string {
  if (!rawPath.includes(" => ")) {
    return rawPath;
  }
  const [, target] = rawPath.split(" => ");
  return target ?? rawPath;
}

function parseCount(value: string): number {
  if (value === "-" || Number.isNaN(Number(value))) {
    return 0;
  }
  return Number(value);
}

function mapGitStatus(code: string): DiffStatus {
  if (!code) {
    return "modified";
  }
  const normalized = code[0]?.toUpperCase();
  if (normalized === "A") {
    return "added";
  }
  if (normalized === "D") {
    return "deleted";
  }
  return "modified";
}

function countLines(content: string | undefined | null): number {
  if (!content) {
    return 0;
  }
  return content.split("\n").length;
}

async function readWorkingTreeFile(
  cwd: string,
  relativePath: string
): Promise<string | null> {
  const file = Bun.file(join(cwd, relativePath));
  if (!(await file.exists())) {
    return null;
  }
  return file.text();
}

async function readGitFile(
  cwd: string,
  ref: string,
  relativePath: string
): Promise<string | null> {
  try {
    const { stdout } = await runGit(["show", `${ref}:${relativePath}`], cwd);
    return stdout;
  } catch {
    return null;
  }
}

async function resolveHeadCommit(cwd: string): Promise<string> {
  const { stdout } = await runGit(["rev-parse", "HEAD"], cwd);
  return stdout;
}

function buildRangeArgs(mode: DiffMode, baseCommit: string | null): string[] {
  if (mode === "workspace") {
    return [WORKSPACE_REF];
  }
  if (!baseCommit) {
    throw new Error("Base commit is required for branch diff mode");
  }
  return [baseCommit];
}

function splitLines(payload: string): string[] {
  return payload
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function parseNumstatOutput(output: string): StatsMap {
  const statsMap: StatsMap = new Map();
  for (const line of splitLines(output)) {
    const segments = line.split("\t");
    if (segments.length < MIN_NUMSTAT_SEGMENTS) {
      continue;
    }
    const additions = parseCount(segments[0] ?? "0");
    const deletions = parseCount(segments[1] ?? "0");
    const rawPath = segments.slice(2).join("\t");
    const path = normalizeNumstatPath(rawPath);
    statsMap.set(path, { additions, deletions });
  }
  return statsMap;
}

function parseStatusOutput(output: string): StatusMap {
  const statusMap: StatusMap = new Map();
  for (const line of splitLines(output)) {
    const parts = line.split("\t").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const code = parts[0] ?? "";
    if (!code) {
      continue;
    }
    const path = parts.pop() ?? "";
    if (!path) {
      continue;
    }
    statusMap.set(path, mapGitStatus(code));
  }
  return statusMap;
}

async function includeUntrackedFiles(
  workspacePath: string,
  statsMap: StatsMap,
  statusMap: StatusMap
) {
  const untracked = await runGit(
    ["ls-files", ...UNTRACKED_EXCLUDES],
    workspacePath
  );
  for (const filePath of splitLines(untracked.stdout)) {
    if (!filePath) {
      continue;
    }
    if (!statusMap.has(filePath)) {
      statusMap.set(filePath, "added");
    }
    if (!statsMap.has(filePath)) {
      const content = await readWorkingTreeFile(workspacePath, filePath);
      statsMap.set(filePath, {
        additions: countLines(content),
        deletions: 0,
      });
    }
  }
}

function buildFileSummaries(statsMap: StatsMap, statusMap: StatusMap) {
  const fileSet = new Set([...statsMap.keys(), ...statusMap.keys()]);
  return Array.from(fileSet)
    .sort()
    .map((path) => {
      const stats = statsMap.get(path);
      const status = statusMap.get(path) ?? "modified";
      return {
        path,
        status,
        additions: stats?.additions ?? 0,
        deletions: stats?.deletions ?? 0,
      } satisfies DiffFileSummary;
    });
}

export async function getConstructDiffSummary(args: {
  workspacePath: string;
  mode: DiffMode;
  baseCommit?: string | null;
}): Promise<{
  mode: DiffMode;
  baseCommit: string | null;
  headCommit: string | null;
  files: DiffFileSummary[];
}> {
  const { workspacePath, mode } = args;
  const headCommit = await resolveHeadCommit(workspacePath);
  const resolvedBase =
    mode === "workspace" ? headCommit : (args.baseCommit ?? null);
  if (mode === "branch" && !resolvedBase) {
    throw new Error("Construct is missing base commit metadata");
  }

  const rangeArgs = buildRangeArgs(mode, resolvedBase);
  const numstatArgs = ["diff", "--numstat", ...rangeArgs, "--"];
  const statusArgs = ["diff", "--name-status", ...rangeArgs, "--"];

  const [numstatOutput, statusOutput] = await Promise.all([
    runGit(numstatArgs, workspacePath),
    runGit(statusArgs, workspacePath),
  ]);

  const statsMap = parseNumstatOutput(numstatOutput.stdout);
  const statusMap = parseStatusOutput(statusOutput.stdout);

  if (mode === "workspace" || mode === "branch") {
    await includeUntrackedFiles(workspacePath, statsMap, statusMap);
  }

  const files = buildFileSummaries(statsMap, statusMap);

  return {
    mode,
    baseCommit: resolvedBase,
    headCommit,
    files,
  };
}

export async function getConstructDiffDetails(args: {
  workspacePath: string;
  mode: DiffMode;
  files: string[];
  baseCommit: string | null;
  summaryFiles?: DiffFileSummary[];
}): Promise<DiffFileDetail[]> {
  const { workspacePath, mode, files, baseCommit, summaryFiles } = args;

  if (files.length === 0) {
    return [];
  }

  const uniqueFiles = Array.from(new Set(files));
  const summaryMap = summaryFiles
    ? new Map(summaryFiles.map((file) => [file.path, file]))
    : null;
  const rangeArgs = buildRangeArgs(mode, baseCommit);

  const details = await Promise.all(
    uniqueFiles.map(async (path) => {
      const summary = summaryMap?.get(path)
        ? summaryMap.get(path)
        : await computeSingleFileSummary({
            workspacePath,
            mode,
            baseCommit,
            path,
          });
      if (!summary) {
        return null;
      }
      return buildFileDetail({
        workspacePath,
        mode,
        rangeArgs,
        baseCommit,
        summary,
      });
    })
  );

  return details.filter((detail): detail is DiffFileDetail => Boolean(detail));
}

async function computeSingleFileSummary(args: {
  workspacePath: string;
  mode: DiffMode;
  baseCommit: string | null;
  path: string;
}): Promise<DiffFileSummary | null> {
  const { workspacePath, mode, baseCommit, path } = args;
  const rangeArgs = buildRangeArgs(mode, baseCommit);
  const numstatArgs = ["diff", "--numstat", ...rangeArgs, "--", path];
  const statusArgs = ["diff", "--name-status", ...rangeArgs, "--", path];

  const [numstatResult, statusResult] = await Promise.allSettled([
    runGit(numstatArgs, workspacePath),
    runGit(statusArgs, workspacePath),
  ]);

  let statsMap: StatsMap = new Map();
  let statusMap: StatusMap = new Map();

  if (numstatResult.status === "fulfilled") {
    statsMap = parseNumstatOutput(numstatResult.value.stdout);
  }
  if (statusResult.status === "fulfilled") {
    statusMap = parseStatusOutput(statusResult.value.stdout);
  }

  const stats = statsMap.get(path);
  const status = statusMap.get(path);

  if (stats || status) {
    return {
      path,
      status: status ?? "modified",
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
    };
  }

  const untracked = await isUntrackedFile(workspacePath, path);
  if (untracked) {
    const workingContent = await readWorkingTreeFile(workspacePath, path);
    return {
      path,
      status: "added",
      additions: countLines(workingContent),
      deletions: 0,
    };
  }

  return null;
}

async function isUntrackedFile(
  workspacePath: string,
  path: string
): Promise<boolean> {
  const { stdout } = await runGit(
    ["ls-files", ...UNTRACKED_EXCLUDES, "--", path],
    workspacePath
  );
  return stdout.trim().length > 0;
}

async function buildFileDetail(args: {
  workspacePath: string;
  mode: DiffMode;
  rangeArgs: string[];
  baseCommit: string | null;
  summary: DiffFileSummary;
}): Promise<DiffFileDetail> {
  const { workspacePath, mode, rangeArgs, baseCommit, summary } = args;
  const patchArgs = [
    "diff",
    PATCH_CONTEXT_ARG,
    ...rangeArgs,
    "--",
    summary.path,
  ];
  const patch = await runGit(patchArgs, workspacePath).catch(() => ({
    stdout: "",
    stderr: "",
  }));

  const beforeRef = resolveBeforeRef(mode, baseCommit);

  const [beforeContent, workingContent] = await Promise.all([
    readFileAtRef(workspacePath, beforeRef, summary.path),
    readWorkingTreeFile(workspacePath, summary.path),
  ]);

  const afterContent = workingContent;
  const isDeleted = summary.status === "deleted";
  const isAdded = summary.status === "added";

  const resolvedBefore = isAdded ? "" : (beforeContent ?? "");
  const resolvedAfter = isDeleted ? "" : (afterContent ?? "");

  return {
    path: summary.path,
    status: summary.status,
    additions: summary.additions,
    deletions: summary.deletions,
    beforeContent: resolvedBefore,
    afterContent: resolvedAfter,
    patch: patch.stdout,
  };
}

function resolveBeforeRef(mode: DiffMode, baseCommit: string | null): string {
  if (mode === "workspace") {
    return WORKSPACE_REF;
  }
  if (!baseCommit) {
    throw new Error("Base commit is required for branch diff details");
  }
  return baseCommit;
}

async function readFileAtRef(
  workspacePath: string,
  ref: string | null,
  relativePath: string
): Promise<string | null> {
  if (!ref) {
    return null;
  }
  return await readGitFile(workspacePath, ref, relativePath);
}
