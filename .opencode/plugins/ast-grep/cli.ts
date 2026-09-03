import { existsSync } from "node:fs";
import { spawn } from "bun";
import {
  DEFAULT_MAX_MATCHES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  findSgCliPathSync,
  getSgCliPath,
  setSgCliPath,
} from "./constants";
import { ensureAstGrepBinary } from "./downloader";
import type { CliLanguage, CliMatch, SgResult } from "./types";

export type RunOptions = {
  cwd: string;
  pattern: string;
  lang: CliLanguage;
  paths?: string[];
  globs?: string[];
  rewrite?: string;
  context?: number;
  updateAll?: boolean;
};

let resolvedCliPath: string | null = null;
let initPromise: Promise<string | null> | null = null;

export const getAstGrepPath = async (): Promise<string | null> => {
  if (resolvedCliPath !== null && existsSync(resolvedCliPath)) {
    return resolvedCliPath;
  }

  if (initPromise) {
    return await initPromise;
  }

  initPromise = (async () => {
    const syncPath = findSgCliPathSync();
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath;
      setSgCliPath(syncPath);
      return syncPath;
    }

    const downloadedPath = await ensureAstGrepBinary();
    if (downloadedPath) {
      resolvedCliPath = downloadedPath;
      setSgCliPath(downloadedPath);
      return downloadedPath;
    }

    return null;
  })();

  return await initPromise;
};

export const startBackgroundInit = (): void => {
  if (!initPromise) {
    initPromise = getAstGrepPath();
    initPromise.catch(() => {
      // ignore
    });
  }
};

const buildRunArgs = (options: RunOptions): string[] => {
  const args = [
    "run",
    "-p",
    options.pattern,
    "--lang",
    options.lang,
    "--json=compact",
  ];

  if (options.rewrite) {
    args.push("-r", options.rewrite);
    if (options.updateAll) {
      args.push("--update-all");
    }
  }

  if (options.context && options.context > 0) {
    args.push("-C", String(options.context));
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob);
    }
  }

  const paths =
    options.paths && options.paths.length > 0 ? options.paths : ["."];
  args.push(...paths);

  return args;
};

type SpawnOutputs = {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputTruncated: boolean;
  timedOut: boolean;
};

async function readBoundedOutput(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  onLimit: () => void
): Promise<{ output: string; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let truncated = false;

  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    const remaining = maximumBytes - bytesRead;
    if (next.value.byteLength > remaining) {
      if (remaining > 0) {
        chunks.push(
          decoder.decode(next.value.subarray(0, remaining), { stream: true })
        );
      }
      truncated = true;
      onLimit();
      break;
    }
    bytesRead += next.value.byteLength;
    chunks.push(decoder.decode(next.value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return { output: chunks.join(""), truncated };
}

const runWithTimeout = async (
  cliPath: string,
  args: string[],
  cwd: string
): Promise<SpawnOutputs> => {
  const proc = spawn([cliPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, DEFAULT_TIMEOUT_MS);

  let killedForOutputLimit = false;
  const killForOutputLimit = () => {
    if (!killedForOutputLimit) {
      killedForOutputLimit = true;
      proc.kill();
    }
  };
  const [stdoutResult, stderrResult, exitCode] = await Promise.all([
    readBoundedOutput(
      proc.stdout as ReadableStream<Uint8Array>,
      DEFAULT_MAX_OUTPUT_BYTES,
      killForOutputLimit
    ),
    readBoundedOutput(
      proc.stderr as ReadableStream<Uint8Array>,
      DEFAULT_MAX_OUTPUT_BYTES,
      killForOutputLimit
    ),
    proc.exited,
  ]);

  clearTimeout(timeoutId);

  return {
    stdout: stdoutResult.output,
    stderr: stderrResult.output,
    exitCode,
    outputTruncated: stdoutResult.truncated || stderrResult.truncated,
    timedOut,
  };
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST-grep CLI wrapper needs full error-handling logic
export const runSg = async (options: RunOptions): Promise<SgResult> => {
  const args = buildRunArgs(options);

  let cliPath = getSgCliPath();
  if (!existsSync(cliPath) || cliPath === "sg") {
    const resolvedPath = await getAstGrepPath();
    if (resolvedPath) {
      cliPath = resolvedPath;
    }
  }

  let outputs: SpawnOutputs;
  try {
    outputs = await runWithTimeout(cliPath, args, options.cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: `Failed to run ast-grep: ${message}`,
    };
  }

  const { stdout, stderr, exitCode, outputTruncated, timedOut } = outputs;

  if (timedOut) {
    return {
      matches: [],
      totalMatches: 0,
      truncated: true,
      truncatedReason: "timeout",
      error: `Search timeout after ${DEFAULT_TIMEOUT_MS}ms`,
    };
  }

  if (exitCode !== 0 && stdout.trim() === "") {
    if (stderr.includes("No files found")) {
      return { matches: [], totalMatches: 0, truncated: false };
    }

    if (stderr.trim()) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        error: stderr.trim(),
      };
    }

    return { matches: [], totalMatches: 0, truncated: false };
  }

  if (!stdout.trim()) {
    return { matches: [], totalMatches: 0, truncated: false };
  }

  const jsonText = stdout;

  let rawMatches: CliMatch[];

  try {
    rawMatches = JSON.parse(jsonText) as CliMatch[];
  } catch {
    const result: SgResult = {
      matches: [],
      totalMatches: 0,
      truncated: outputTruncated,
    };

    if (outputTruncated) {
      result.truncatedReason = "max_output_bytes";
      result.error = "Output too large and could not be parsed";
    }

    return result;
  }

  const totalMatches = rawMatches.length;
  const matchesTruncated = totalMatches > DEFAULT_MAX_MATCHES;
  const matches = matchesTruncated
    ? rawMatches.slice(0, DEFAULT_MAX_MATCHES)
    : rawMatches;

  let truncatedReason: SgResult["truncatedReason"];
  if (outputTruncated) {
    truncatedReason = "max_output_bytes";
  } else if (matchesTruncated) {
    truncatedReason = "max_matches";
  } else {
    truncatedReason = undefined;
  }

  return {
    matches,
    totalMatches,
    truncated: outputTruncated || matchesTruncated,
    truncatedReason,
  };
};

export const isCliAvailable = (): boolean => {
  const path = findSgCliPathSync();
  return path !== null && existsSync(path);
};

export const ensureCliAvailable = async (): Promise<boolean> => {
  const path = await getAstGrepPath();
  return path !== null && existsSync(path);
};
