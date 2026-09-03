import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const installScript = fileURLToPath(new URL("./install.sh", import.meta.url));
const expectedVersion = "opencode2 v0.0.0-beta-18866";
const EXECUTABLE_PERMISSIONS = 0o755;
const tempDirectoryFixture = (() => {
  const directories = new Set<string>();
  return {
    create: () => {
      const directory = mkdtempSync(join(tmpdir(), "hive-installer-"));
      directories.add(directory);
      return directory;
    },
    cleanup: () => {
      for (const directory of directories) {
        rmSync(directory, { recursive: true, force: true });
      }
      directories.clear();
    },
  };
})();

const run = (cmd: string[], env?: Record<string, string>) =>
  Bun.spawnSync({
    cmd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

const createArchive = (opencodeContents?: string) => {
  const fixtureRoot = tempDirectoryFixture.create();
  const releaseName = `hive-${process.platform}-${process.arch}`;
  const releaseDirectory = join(fixtureRoot, releaseName);
  mkdirSync(join(releaseDirectory, "public"), { recursive: true });
  mkdirSync(join(releaseDirectory, "migrations"), { recursive: true });

  const hiveBinary = join(releaseDirectory, "hive");
  writeFileSync(hiveBinary, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(hiveBinary, EXECUTABLE_PERMISSIONS);

  if (opencodeContents !== undefined) {
    const opencodeBinary = join(releaseDirectory, "opencode2");
    writeFileSync(opencodeBinary, opencodeContents);
    chmodSync(opencodeBinary, EXECUTABLE_PERMISSIONS);
  }

  const archivePath = join(fixtureRoot, `${releaseName}.tar.gz`);
  const tarResult = run([
    "tar",
    "-czf",
    archivePath,
    "-C",
    fixtureRoot,
    releaseName,
  ]);
  if (tarResult.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(tarResult.stderr));
  }
  return archivePath;
};

const runInstaller = (
  archivePath: string,
  installRoot: string,
  binDirectory: string
) =>
  run(["bash", installScript], {
    HIVE_BIN_DIR: binDirectory,
    HIVE_HOME: installRoot,
    HIVE_INSTALL_URL: `file://${archivePath}`,
    HIVE_OPENCODE_BIN: "/explicit/override/opencode2",
    HOME: installRoot,
    PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    PORT: "61991",
    SHELL: "/bin/bash",
  });

const installArchive = (
  archivePath: string,
  prepare?: (paths: { binDirectory: string; installRoot: string }) => void
) => {
  const installRoot = tempDirectoryFixture.create();
  const binDirectory = join(installRoot, "bin");
  mkdirSync(binDirectory, { recursive: true });
  prepare?.({ binDirectory, installRoot });

  const result = runInstaller(archivePath, installRoot, binDirectory);

  return { binDirectory, installRoot, result };
};

afterEach(tempDirectoryFixture.cleanup);

describe("install.sh bundled OpenCode 2 handling", () => {
  test("installs, configures, and exposes the bundled exact binary", () => {
    const archivePath = createArchive(
      `#!/usr/bin/env bash\nif [ "$1" = "--check-env" ]; then printf '%s\\n' "$OPENCODE_DISABLE_AUTOUPDATE"; exit 0; fi\nprintf ' ${expectedVersion} \\n'\n`
    );
    const { binDirectory, installRoot, result } = installArchive(archivePath);

    expect(result.exitCode).toBe(0);
    const currentRelease = realpathSync(join(installRoot, "current"));
    const bundledBinary = join(currentRelease, "opencode2");
    const exposedBinary = join(binDirectory, "opencode2");
    expect(readFileSync(exposedBinary, "utf8")).toContain(
      "OPENCODE_DISABLE_AUTOUPDATE=1"
    );
    expect(readFileSync(exposedBinary, "utf8")).toContain(
      "# Managed by Hive: opencode2"
    );
    const exposedResult = run([exposedBinary, "--check-env"]);
    expect(exposedResult.exitCode).toBe(0);
    expect(new TextDecoder().decode(exposedResult.stdout).trim()).toBe("1");
    expect(readFileSync(join(currentRelease, "hive.env"), "utf8")).toContain(
      `HIVE_OPENCODE_BIN="${bundledBinary}"`
    );
    expect(new TextDecoder().decode(result.stdout)).toContain(
      `Using bundled OpenCode 2 CLI at ${bundledBinary}`
    );
  });

  test("rejects a release missing the bundled binary", () => {
    const { result } = installArchive(createArchive());

    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toContain(
      "bundled OpenCode 2 binary missing or not executable"
    );
  });

  test("rejects a release with the wrong bundled version", () => {
    const archivePath = createArchive(
      "#!/usr/bin/env bash\nprintf 'opencode2 v1.0.0\\n'\n"
    );
    const { result } = installArchive(archivePath);

    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toContain(
      "bundled OpenCode 2 version mismatch"
    );
  });

  test("refuses to replace an unmanaged OpenCode command", () => {
    const archivePath = createArchive(
      `#!/usr/bin/env bash\nprintf ' ${expectedVersion} \\n'\n`
    );
    const unmanagedContents = "#!/usr/bin/env bash\nprintf 'unmanaged\\n'\n";
    const { binDirectory, result } = installArchive(
      archivePath,
      ({ binDirectory: preparedBinDirectory }) => {
        const unmanagedBinary = join(preparedBinDirectory, "opencode2");
        writeFileSync(unmanagedBinary, unmanagedContents);
        chmodSync(unmanagedBinary, EXECUTABLE_PERMISSIONS);
      }
    );

    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(join(binDirectory, "opencode2"), "utf8")).toBe(
      unmanagedContents
    );
    expect(new TextDecoder().decode(result.stderr)).toContain(
      "refusing to replace unmanaged OpenCode command"
    );
  });

  test("replaces its managed launcher and preserves environment on upgrade", () => {
    const archivePath = createArchive(
      `#!/usr/bin/env bash\nif [ "$1" = "--check-env" ]; then printf '%s\\n' "$OPENCODE_DISABLE_AUTOUPDATE"; exit 0; fi\nprintf ' ${expectedVersion} \\n'\n`
    );
    const first = installArchive(archivePath);
    expect(first.result.exitCode).toBe(0);
    const firstRelease = realpathSync(join(first.installRoot, "current"));
    const firstEnvPath = join(firstRelease, "hive.env");
    writeFileSync(
      firstEnvPath,
      `${readFileSync(firstEnvPath, "utf8")}CUSTOM_SETTING="preserved"\n`
    );

    const secondResult = runInstaller(
      archivePath,
      first.installRoot,
      first.binDirectory
    );

    expect(secondResult.exitCode).toBe(0);
    const secondRelease = realpathSync(join(first.installRoot, "current"));
    expect(secondRelease).not.toBe(firstRelease);
    const secondEnv = readFileSync(join(secondRelease, "hive.env"), "utf8");
    expect(secondEnv).toContain('CUSTOM_SETTING="preserved"');
    expect(secondEnv).toContain(
      `HIVE_OPENCODE_BIN="${join(secondRelease, "opencode2")}"`
    );
    const exposedResult = run([
      join(first.binDirectory, "opencode2"),
      "--check-env",
    ]);
    expect(exposedResult.exitCode).toBe(0);
    expect(new TextDecoder().decode(exposedResult.stdout).trim()).toBe("1");
  });
});
