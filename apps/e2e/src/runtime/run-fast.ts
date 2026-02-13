import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type WorkerResolution = {
  source: "env" | "default";
  value: string;
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");
const FAILURE_EXIT_CODE = 1;
const DEFAULT_FAST_WORKERS = 4;

async function run(): Promise<void> {
  const workerResolution = resolveWorkerSetting();
  const forwardedArgs = process.argv.slice(2);
  const videoMode = process.env.HIVE_E2E_VIDEO_MODE ?? "on";

  process.stdout.write(
    `Running fast E2E with workers=${workerResolution.value} (source=${workerResolution.source}) video=${videoMode}\n`
  );

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(
      "bun",
      ["run", "src/runtime/e2e-runner.ts", ...forwardedArgs],
      {
        cwd: e2eRoot,
        env: {
          ...process.env,
          HIVE_E2E_VIDEO_MODE: videoMode,
          HIVE_E2E_WORKERS: workerResolution.value,
        },
        stdio: "inherit",
      }
    );

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

  process.exitCode = exitCode;
}

function resolveWorkerSetting(): WorkerResolution {
  const envWorkers = process.env.HIVE_E2E_WORKERS?.trim();
  if (envWorkers) {
    return { source: "env", value: envWorkers };
  }

  return { source: "default", value: String(DEFAULT_FAST_WORKERS) };
}

run().catch((error) => {
  process.stderr.write(
    `Fast E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = FAILURE_EXIT_CODE;
});
