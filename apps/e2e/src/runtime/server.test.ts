import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Service } from "@opencode-ai/client/service";
import { readProcessTable } from "./process";
import type { RuntimeContext } from "./runtime-context";
import {
  cleanupRegisteredOpencodeServices,
  stopIsolatedOpencodeService,
} from "./server";

const temporaryRoots: string[] = [];
const FILE_PERMISSION_MODULUS = 0o1000;
const OWNER_ONLY_FILE_MODE = 0o600;
const LONG_RUNNING_SCRIPT = "setInterval(() => {}, 1000)";
const PRESERVED_STATE = { processAlive: true, registrationExists: true };
const STOPPED_STATE = { processAlive: false, registrationExists: false };

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRunsRoot() {
  const runsRoot = await mkdtemp(join(tmpdir(), "hive-e2e-services-"));
  temporaryRoots.push(runsRoot);
  return runsRoot;
}

function processOptionsForRun(runRoot: string) {
  return {
    args: [
      "-e",
      LONG_RUNNING_SCRIPT,
      join(runRoot, "opencode2"),
      "serve",
      "--service",
    ],
    env: {
      OPENCODE_DB: join(runRoot, "opencode.db"),
      XDG_STATE_HOME: join(runRoot, "opencode-xdg", "state"),
    },
  };
}

async function createServiceRegistration(
  pid: number,
  runName: string,
  runsRoot: string
) {
  const runRoot = join(runsRoot, runName);
  const file = join(
    runRoot,
    "opencode-xdg",
    "state",
    "opencode",
    "service.json"
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      id: "test-service",
      password: "pw",
      pid,
      url: "http://127.0.0.1:9",
      version: "test-version",
    })
  );
  return { file, runRoot, runsRoot };
}

function spawnTestProcess(args: string[], env?: NodeJS.ProcessEnv) {
  return Bun.spawn([process.execPath, ...args], {
    env: env ? { ...process.env, ...env } : undefined,
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  });
}

type TestProcess = ReturnType<typeof spawnTestProcess>;
type ServiceRegistration = Awaited<
  ReturnType<typeof createServiceRegistration>
>;
type RegisteredService = {
  child: TestProcess;
  registration: ServiceRegistration;
  runRoot: string;
  runsRoot: string;
};

async function withTestProcess<Result>(
  args: string[],
  run: (child: TestProcess) => Promise<Result>,
  env?: NodeJS.ProcessEnv
): Promise<Result> {
  const child = spawnTestProcess(args, env);
  try {
    return await run(child);
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

async function withRegisteredService<Result>(
  options: {
    command?: "idle" | "owned";
    environment?: "none" | "other" | "owned";
    runName?: string;
    runsRoot?: string;
  },
  run: (fixture: RegisteredService) => Promise<Result>
): Promise<Result> {
  const runsRoot = options.runsRoot ?? (await createRunsRoot());
  const runName = options.runName ?? "stale-run";
  const runRoot = join(runsRoot, runName);
  const owned = processOptionsForRun(runRoot);
  const args =
    options.command === "idle" ? ["-e", LONG_RUNNING_SCRIPT] : owned.args;
  const environment = options.environment ?? "owned";
  const env =
    environment === "none"
      ? undefined
      : processOptionsForRun(
          environment === "other" ? join(runsRoot, "other-run") : runRoot
        ).env;

  return await withTestProcess(
    args,
    async (child) => {
      const registration = await createServiceRegistration(
        child.pid,
        runName,
        runsRoot
      );
      return await run({ child, registration, runRoot, runsRoot });
    },
    env
  );
}

async function readServiceState(fixture: RegisteredService) {
  const activePids = new Set(readProcessTable().map((entry) => entry.pid));
  return {
    processAlive: activePids.has(fixture.child.pid),
    registrationExists: await Bun.file(fixture.registration.file).exists(),
  };
}

const stopRunService = (runRoot: string) =>
  stopIsolatedOpencodeService({ runRoot } as RuntimeContext);

const cleanupServices = (
  runsRoot: string,
  preserveRunRoot = join(runsRoot, "current-run")
) => cleanupRegisteredOpencodeServices({ preserveRunRoot, runsRoot });

describe("stopIsolatedOpencodeService", () => {
  it("stops a service owned by the current run", async () => {
    await withRegisteredService({ runName: "current-run" }, async (fixture) => {
      await stopRunService(fixture.runRoot);
      await fixture.child.exited;
      expect(await readServiceState(fixture)).toEqual(STOPPED_STATE);
    });
  });

  it.each([
    {
      command: "idle",
      environment: "owned",
      name: "a live process that is not an OpenCode service",
    },
    {
      command: "owned",
      environment: "other",
      name: "an OpenCode service owned by another run environment",
    },
  ] as const)("refuses $name", async ({ command, environment }) => {
    await withRegisteredService(
      { command, environment, runName: "current-run" },
      async (fixture) => {
        await expect(stopRunService(fixture.runRoot)).rejects.toThrow(
          "Refusing to stop an OpenCode PID"
        );
        expect(await readServiceState(fixture)).toEqual(PRESERVED_STATE);
      }
    );
  });

  it("removes a stale registration after its process exits", async () => {
    const runsRoot = await createRunsRoot();
    const child = spawnTestProcess(["-e", "process.exit(0)"]);
    await child.exited;
    const registration = await createServiceRegistration(
      child.pid,
      "stale-run",
      runsRoot
    );

    await stopRunService(registration.runRoot);
    expect(await Bun.file(registration.file).exists()).toBe(false);
  });
});

describe("cleanupRegisteredOpencodeServices", () => {
  it("preserves ownership records for live unowned services", async () => {
    await withRegisteredService(
      { command: "idle", environment: "none" },
      async (fixture) => {
        expect(await cleanupServices(fixture.runsRoot)).toBe(0);
        expect(await readServiceState(fixture)).toEqual(PRESERVED_STATE);
      }
    );
  });

  it("recovers a registration quarantined by interrupted cleanup", async () => {
    await withRegisteredService(
      { command: "idle", environment: "none" },
      async (fixture) => {
        const quarantined = `${fixture.registration.file}.hive-remove-interrupted`;
        await rename(fixture.registration.file, quarantined);

        expect(await cleanupServices(fixture.runsRoot)).toBe(0);
        expect(await readServiceState(fixture)).toEqual(PRESERVED_STATE);
        expect(await Bun.file(quarantined).exists()).toBe(false);
      }
    );
  });

  it("stops a live owned service from an inactive prior run", async () => {
    await withRegisteredService(
      { runName: "inactive-run" },
      async (fixture) => {
        expect(await cleanupServices(fixture.runsRoot)).toBe(1);
        await fixture.child.exited;
        expect(await readServiceState(fixture)).toEqual(STOPPED_STATE);
      }
    );
  });

  it("preserves the current run even when its service is owned", async () => {
    await withRegisteredService({ runName: "current-run" }, async (fixture) => {
      expect(await cleanupServices(fixture.runsRoot, fixture.runRoot)).toBe(0);
      expect(await readServiceState(fixture)).toEqual(PRESERVED_STATE);
    });
  });

  it("preserves an owned service belonging to a concurrent runner", async () => {
    const runsRoot = await createRunsRoot();
    await withTestProcess(
      ["-e", LONG_RUNNING_SCRIPT, "src/runtime/e2e-runner.ts"],
      async (runner) => {
        await withRegisteredService(
          { runName: `active-run-${runner.pid}`, runsRoot },
          async (fixture) => {
            expect(await cleanupServices(runsRoot)).toBe(0);
            expect(await readServiceState(fixture)).toEqual(PRESERVED_STATE);
          }
        );
      }
    );
  });

  it("preserves a registration replaced during validated shutdown", async () => {
    await withRegisteredService(
      { runName: "replaced-run" },
      async (fixture) => {
        await withTestProcess(
          ["-e", LONG_RUNNING_SCRIPT],
          async (replacement) => {
            const replacementRegistration = {
              id: "replacement-service",
              password: "pw",
              pid: replacement.pid,
              url: "http://127.0.0.1:10",
              version: "replacement-version",
            };
            let validatedFileMode: number | undefined;
            const stop = spyOn(Service, "stop").mockImplementation(
              async (options) => {
                if (!options?.file) {
                  throw new Error("Expected a validated registration file");
                }
                validatedFileMode =
                  (await stat(options.file)).mode % FILE_PERMISSION_MODULUS;
                await writeFile(
                  fixture.registration.file,
                  JSON.stringify(replacementRegistration)
                );
              }
            );

            try {
              expect(await cleanupServices(fixture.runsRoot)).toBe(1);
              expect(validatedFileMode).toBe(OWNER_ONLY_FILE_MODE);
              expect(
                JSON.parse(await readFile(fixture.registration.file, "utf8"))
              ).toEqual(replacementRegistration);
              expect(() => process.kill(replacement.pid, 0)).not.toThrow();
            } finally {
              stop.mockRestore();
            }
          }
        );
      }
    );
  });
});
