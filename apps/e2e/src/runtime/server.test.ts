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
import { cleanupRegisteredOpencodeServices } from "./server";

const temporaryRoots: string[] = [];
const FILE_PERMISSION_MODULUS = 0o1000;
const OWNER_ONLY_FILE_MODE = 0o600;

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

async function createOwnedRun(runName: string) {
  const runsRoot = await createRunsRoot();
  const runRoot = join(runsRoot, runName);
  return {
    args: [
      "-e",
      "setInterval(() => {}, 1000)",
      join(runRoot, "opencode2"),
      "serve",
      "--service",
    ],
    env: {
      OPENCODE_DB: join(runRoot, "opencode.db"),
      XDG_STATE_HOME: join(runRoot, "opencode-xdg", "state"),
    },
    runName,
    runsRoot,
  };
}

async function createServiceRegistration(
  pid: number,
  runName = "stale-run",
  existingRunsRoot?: string
) {
  const runsRoot = existingRunsRoot ?? (await createRunsRoot());
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

async function withTestProcess<Result>(
  args: string[],
  run: (child: ReturnType<typeof spawnTestProcess>) => Promise<Result>,
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

const cleanupRegistration = (registration: { runsRoot: string }) =>
  cleanupRegisteredOpencodeServices({
    preserveRunRoot: join(registration.runsRoot, "current-run"),
    runsRoot: registration.runsRoot,
  });

describe("cleanupRegisteredOpencodeServices", () => {
  it("preserves ownership records for live unresponsive services", async () => {
    await withTestProcess(
      ["-e", "setInterval(() => {}, 1000)"],
      async (child) => {
        const registration = await createServiceRegistration(child.pid);
        expect(await cleanupRegistration(registration)).toBe(0);
        expect(await Bun.file(registration.file).exists()).toBe(true);
        expect(() => process.kill(child.pid, 0)).not.toThrow();
      }
    );
  });

  it("recovers a registration quarantined by interrupted cleanup", async () => {
    await withTestProcess(
      ["-e", "setInterval(() => {}, 1000)"],
      async (child) => {
        const registration = await createServiceRegistration(child.pid);
        const quarantined = `${registration.file}.hive-remove-interrupted`;
        await rename(registration.file, quarantined);

        expect(await cleanupRegistration(registration)).toBe(0);
        expect(await Bun.file(registration.file).exists()).toBe(true);
        expect(await Bun.file(quarantined).exists()).toBe(false);
        expect(() => process.kill(child.pid, 0)).not.toThrow();
      }
    );
  });

  it("removes registrations after their service exits", async () => {
    const child = spawnTestProcess(["-e", "process.exit(0)"]);
    await child.exited;
    const registration = await createServiceRegistration(child.pid);

    expect(await cleanupRegistration(registration)).toBe(0);
    expect(await Bun.file(registration.file).exists()).toBe(false);
  });

  it("stops a live service owned by an inactive run", async () => {
    const ownedRun = await createOwnedRun("owned-run");
    await withTestProcess(
      ownedRun.args,
      async (child) => {
        const registration = await createServiceRegistration(
          child.pid,
          ownedRun.runName,
          ownedRun.runsRoot
        );

        expect(await cleanupRegistration(registration)).toBe(1);
        expect(await Bun.file(registration.file).exists()).toBe(false);
        await expect(child.exited).resolves.toBeNumber();
      },
      ownedRun.env
    );
  });

  it("preserves a registration replaced during validated shutdown", async () => {
    const ownedRun = await createOwnedRun("replaced-run");
    await withTestProcess(
      ownedRun.args,
      async (ownedChild) => {
        await withTestProcess(
          ["-e", "setInterval(() => {}, 1000)"],
          async (replacementChild) => {
            const registration = await createServiceRegistration(
              ownedChild.pid,
              ownedRun.runName,
              ownedRun.runsRoot
            );
            const replacement = {
              id: "replacement-service",
              password: "pw",
              pid: replacementChild.pid,
              url: "http://127.0.0.1:10",
              version: "replacement-version",
            };
            let validatedFileMode: number | undefined;
            const stop = spyOn(Service, "stop").mockImplementation(
              async (options) => {
                const validatedFile = options.file as string;
                validatedFileMode =
                  (await stat(validatedFile)).mode % FILE_PERMISSION_MODULUS;
                await writeFile(registration.file, JSON.stringify(replacement));
              }
            );

            try {
              expect(await cleanupRegistration(registration)).toBe(1);
              expect(validatedFileMode).toBe(OWNER_ONLY_FILE_MODE);
              expect(
                JSON.parse(await readFile(registration.file, "utf8"))
              ).toEqual(replacement);
              expect(() => process.kill(replacementChild.pid, 0)).not.toThrow();
            } finally {
              stop.mockRestore();
            }
          }
        );
      },
      ownedRun.env
    );
  });

  it("does not clean a run whose runner started during stale cleanup", async () => {
    await withTestProcess(
      ["-e", "setInterval(() => {}, 1000)", "src/runtime/e2e-runner.ts"],
      async (child) => {
        const registration = await createServiceRegistration(
          child.pid,
          `active-run-${child.pid}`
        );
        expect(await cleanupRegistration(registration)).toBe(0);
        expect(await Bun.file(registration.file).exists()).toBe(true);
      }
    );
  });
});
