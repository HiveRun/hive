#!/usr/bin/env bun

import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const releaseBaseDir = join(repoRoot, "dist", "install");
const platform = process.platform;
const arch = process.arch;
const releaseName = `hive-${platform}-${arch}`;
const releaseDir = join(releaseBaseDir, releaseName);

const desktopBinaryName = "hive-desktop";
const desktopElectronRoot = join(repoRoot, "apps", "desktop-electron");
const desktopElectronOutputDir = join(desktopElectronRoot, "out");

const run = async (
  cmd: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => {
  const process = Bun.spawn({
    cmd,
    cwd: options?.cwd ?? repoRoot,
    env: options?.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(`Command failed (${cmd.join(" ")}) with exit code ${code}`);
  }
};

const runCapture = (cmd: string[], cwd = repoRoot) => {
  const result = Bun.spawnSync({ cmd, cwd });
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with exit code ${result.exitCode}`
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
};

const ensureDir = async (path: string) => {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
};

const buildFrontend = () =>
  run(["bun", "run", "build"], {
    cwd: join(repoRoot, "apps", "web"),
    env: {
      ...process.env,
      VITE_APP_BASE: "./",
    },
  });
const buildCli = () =>
  run(["bun", "run", "compile"], {
    cwd: join(repoRoot, "packages", "cli"),
  });
const buildDesktopElectron = () =>
  run(["bun", "run", "package"], {
    cwd: desktopElectronRoot,
  });

const readRootPackage = async () => {
  const packageJsonPath = join(repoRoot, "package.json");
  const packageContents = await Bun.file(packageJsonPath).text();
  return JSON.parse(packageContents) as { version?: string };
};

const computeSha256 = async (filePath: string) => {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(filePath).arrayBuffer());
  return hasher.digest("hex");
};

const EXECUTABLE_PERMISSIONS = 0o755;

const makeExecutable = async (filePath: string) => {
  if (process.platform === "win32") {
    return;
  }
  await chmod(filePath, EXECUTABLE_PERMISSIONS);
};

const copyLinuxElectronArtifacts = async (destination: string) => {
  const entries = existsSync(desktopElectronOutputDir)
    ? await readdir(desktopElectronOutputDir)
    : [];

  const appImage = entries.find((entry) => entry.endsWith(".AppImage"));
  if (appImage) {
    const source = join(desktopElectronOutputDir, appImage);
    const targetPath = join(destination, `${desktopBinaryName}.AppImage`);
    await copyFile(source, targetPath);
    await makeExecutable(targetPath);
  }

  const unpackedDir = entries.find((entry) => entry.endsWith("linux-unpacked"));
  if (unpackedDir) {
    const source = join(desktopElectronOutputDir, unpackedDir, "hive-desktop");
    if (existsSync(source)) {
      const targetPath = join(destination, desktopBinaryName);
      await copyFile(source, targetPath);
      await makeExecutable(targetPath);
    }
  }
};

const copyMacElectronArtifacts = async (destination: string) => {
  const entries = existsSync(desktopElectronOutputDir)
    ? await readdir(desktopElectronOutputDir)
    : [];

  const appDir = entries.find((entry) => entry.endsWith(".app"));
  if (appDir) {
    const source = join(desktopElectronOutputDir, appDir);
    const targetPath = join(destination, appDir);
    await rm(targetPath, { recursive: true, force: true });
    await cp(source, targetPath, { recursive: true });
  }

  const zipFile = entries.find((entry) => entry.endsWith(".zip"));
  if (zipFile) {
    await copyFile(
      join(desktopElectronOutputDir, zipFile),
      join(destination, zipFile)
    );
  }
};

const copyWindowsElectronArtifacts = async (destination: string) => {
  const entries = existsSync(desktopElectronOutputDir)
    ? await readdir(desktopElectronOutputDir)
    : [];

  const setupExe = entries.find((entry) => entry.endsWith("Setup.exe"));
  if (setupExe) {
    await copyFile(
      join(desktopElectronOutputDir, setupExe),
      join(destination, setupExe)
    );
  }

  const unpackedDir = entries.find((entry) => entry.endsWith("win-unpacked"));
  if (unpackedDir) {
    const source = join(
      desktopElectronOutputDir,
      unpackedDir,
      "hive-desktop.exe"
    );
    if (existsSync(source)) {
      await copyFile(source, join(destination, `${desktopBinaryName}.exe`));
    }
  }
};

const copyDesktopBundle = async (destination: string) => {
  if (platform === "darwin") {
    await copyMacElectronArtifacts(destination);
    return;
  }

  if (platform === "win32") {
    await copyWindowsElectronArtifacts(destination);
    return;
  }

  await copyLinuxElectronArtifacts(destination);
};

const main = async () => {
  await ensureDir(releaseDir);

  await buildFrontend();
  await buildCli();
  await buildDesktopElectron();

  const cliBinaryPath = join(repoRoot, "packages", "cli", "hive");
  if (!existsSync(cliBinaryPath)) {
    throw new Error("Compiled CLI binary not found. Did the build succeed?");
  }

  const binaryDestination = join(releaseDir, "hive");
  await copyFile(cliBinaryPath, binaryDestination);
  await chmod(binaryDestination, EXECUTABLE_PERMISSIONS);

  const frontendDist = join(repoRoot, "apps", "web", "dist");
  if (!existsSync(frontendDist)) {
    throw new Error(
      "Frontend dist directory missing. Run the web build first."
    );
  }

  await cp(frontendDist, join(releaseDir, "public"), { recursive: true });

  const installerScriptSource = join(repoRoot, "scripts", "install.sh");
  await copyFile(installerScriptSource, join(releaseDir, "install.sh"));
  await chmod(join(releaseDir, "install.sh"), EXECUTABLE_PERMISSIONS);

  const serverMigrationsDir = join(
    repoRoot,
    "apps",
    "server",
    "src",
    "migrations"
  );
  if (!existsSync(serverMigrationsDir)) {
    throw new Error("Server migrations directory missing.");
  }
  await cp(serverMigrationsDir, join(releaseDir, "migrations"), {
    recursive: true,
  });

  await copyDesktopBundle(releaseDir);

  const pkg = await readRootPackage();
  const commitSha = (() => {
    try {
      return runCapture(["git", "rev-parse", "--short", "HEAD"]);
    } catch {
      return "unknown";
    }
  })();

  const manifest = {
    name: "hive",
    version: Bun.env.HIVE_VERSION ?? pkg.version ?? "0.0.0-dev",
    platform,
    arch,
    commit: commitSha,
    builtAt: new Date().toISOString(),
    binary: "hive",
    assetsDir: "public",
  } satisfies Record<string, string>;

  await writeFile(
    join(releaseDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const tarballName = `${releaseName}.tar.gz`;
  const tarballPath = join(releaseBaseDir, tarballName);

  await run(["tar", "-czf", tarballPath, "-C", releaseBaseDir, releaseName]);

  await rm(cliBinaryPath, { force: true });

  const sha256 = await computeSha256(tarballPath);
  await writeFile(
    `${tarballPath}.sha256`,
    `${sha256}  ${basename(tarballPath)}\n`
  );

  console.log("\nDistribution ready:");
  console.log(`  Binary: ${binaryDestination}`);
  console.log(`  Public assets: ${join(releaseDir, "public")}`);
  console.log(`  Tarball: ${tarballPath}`);
  console.log(`  SHA256: ${sha256}`);
};

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
