import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FAST_WORKERS_LOW = 2;
const DEFAULT_FAST_WORKERS_MEDIUM = 3;
const DEFAULT_FAST_WORKERS_HIGH = 4;
const DEFAULT_WORKERS = [
  DEFAULT_FAST_WORKERS_LOW,
  DEFAULT_FAST_WORKERS_MEDIUM,
  DEFAULT_FAST_WORKERS_HIGH,
] as const;
const DEFAULT_REPEATS = 1;
const FAILURE_EXIT_CODE = 1;
const MILLISECONDS_PER_SECOND = 1000;
const DURATION_DECIMALS = 1;

type BenchmarkRun = {
  exitCode: number;
  ms: number;
};

type BenchmarkCase = {
  workers: number;
  runs: BenchmarkRun[];
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");

async function run(): Promise<void> {
  const workersToTest = parseWorkerList(process.env.HIVE_E2E_BENCH_WORKERS);
  const repeats = parseRepeats(process.env.HIVE_E2E_BENCH_REPEATS);

  process.stdout.write(
    `Benchmarking E2E worker counts: ${workersToTest.join(", ")} (repeats: ${String(repeats)})\n`
  );

  const cases: BenchmarkCase[] = [];

  for (const workers of workersToTest) {
    const currentCase: BenchmarkCase = { runs: [], workers };

    for (let iteration = 1; iteration <= repeats; iteration += 1) {
      process.stdout.write(
        `\n[workers=${String(workers)}] Run ${String(iteration)}/${String(repeats)}\n`
      );
      const startedAt = Date.now();
      const exitCode = await runSuiteWithWorkers(workers);
      const elapsedMs = Date.now() - startedAt;
      currentCase.runs.push({ exitCode, ms: elapsedMs });

      process.stdout.write(
        `[workers=${String(workers)}] exit=${String(exitCode)} time=${formatDuration(elapsedMs)}\n`
      );
    }

    cases.push(currentCase);
  }

  process.stdout.write("\n=== Benchmark Summary ===\n");

  for (const currentCase of cases) {
    const successes = currentCase.runs.filter(
      (runResult) => runResult.exitCode === 0
    );
    const failures = currentCase.runs.length - successes.length;

    if (successes.length === 0) {
      process.stdout.write(
        `workers=${String(currentCase.workers)} -> all runs failed (${String(failures)}/${String(currentCase.runs.length)})\n`
      );
      continue;
    }

    const avgMs = Math.round(
      successes.reduce((acc, runResult) => acc + runResult.ms, 0) /
        successes.length
    );
    const bestMs = Math.min(...successes.map((runResult) => runResult.ms));

    process.stdout.write(
      `workers=${String(currentCase.workers)} -> avg=${formatDuration(avgMs)} best=${formatDuration(bestMs)} failures=${String(failures)}\n`
    );
  }

  const successfulCases = cases
    .map((currentCase) => summarizeCase(currentCase))
    .filter(
      (summary): summary is NonNullable<typeof summary> => summary !== null
    )
    .sort((left, right) => left.avgMs - right.avgMs);

  if (successfulCases.length === 0) {
    process.stderr.write("No successful benchmark runs were recorded.\n");
    process.exitCode = FAILURE_EXIT_CODE;
    return;
  }

  const winner = successfulCases[0];
  process.stdout.write(
    `\nRecommended workers: ${String(winner.workers)} (avg ${formatDuration(winner.avgMs)})\n`
  );
}

function summarizeCase(currentCase: BenchmarkCase) {
  const successes = currentCase.runs.filter(
    (runResult) => runResult.exitCode === 0
  );
  if (successes.length === 0) {
    return null;
  }

  const avgMs = Math.round(
    successes.reduce((acc, runResult) => acc + runResult.ms, 0) /
      successes.length
  );

  return {
    avgMs,
    workers: currentCase.workers,
  };
}

function parseWorkerList(value: string | undefined): number[] {
  if (!value?.trim()) {
    return [...DEFAULT_WORKERS];
  }

  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));

  if (parsed.length === 0) {
    return [...DEFAULT_WORKERS];
  }

  return [...new Set(parsed)];
}

function parseRepeats(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_REPEATS;
  }

  const repeats = Number(value);
  if (!Number.isFinite(repeats) || repeats < 1) {
    return DEFAULT_REPEATS;
  }

  return Math.floor(repeats);
}

function runSuiteWithWorkers(workers: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", "src/runtime/e2e-runner.ts"], {
      cwd: e2eRoot,
      env: {
        ...process.env,
        HIVE_E2E_VIDEO_MODE: process.env.HIVE_E2E_VIDEO_MODE ?? "on",
        HIVE_E2E_WORKERS: String(workers),
      },
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(FAILURE_EXIT_CODE);
        return;
      }

      resolve(code ?? FAILURE_EXIT_CODE);
    });

    child.on("error", () => {
      resolve(FAILURE_EXIT_CODE);
    });
  });
}

function formatDuration(ms: number): string {
  const seconds = (ms / MILLISECONDS_PER_SECOND).toFixed(DURATION_DECIMALS);
  return `${seconds}s`;
}

run().catch((error) => {
  process.stderr.write(
    `E2E worker benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = FAILURE_EXIT_CODE;
});
