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
const desktopAppBundleName = "Hive Desktop.app";
const legacyDesktopAppBundleName = "Hive.app";

const run = async (cmd: string[], cwd = repoRoot) => {
  const process = Bun.spawn({
    cmd,
    cwd,
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
  run(["bun", "run", "build"], join(repoRoot, "apps", "web"));
const buildCli = () =>
  run(["bun", "run", "compile"], join(repoRoot, "packages", "cli"));
const buildTauri = () => run(["bun", "run", "build:tauri"], repoRoot);

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
const tauriTargetDir = join(repoRoot, "src-tauri", "target", "release");

// Force Cargo to write build artifacts inside this repository so Tauri plugins
// don't inherit stale paths from a global CARGO_TARGET_DIR.
process.env.CARGO_TARGET_DIR = join(repoRoot, "src-tauri", "target");

const makeExecutable = async (filePath: string) => {
  if (process.platform === "win32") {
    return;
  }
  await chmod(filePath, EXECUTABLE_PERMISSIONS);
};

const copyLinuxTauriArtifacts = async (destination: string) => {
  let copied = false;
  const appImageDir = join(tauriTargetDir, "bundle", "appimage");
  if (existsSync(appImageDir)) {
    const entries = await readdir(appImageDir);
    const appImage = entries.find((entry) =>
      entry.toLowerCase().endsWith(".appimage")
    );
    if (appImage) {
      const source = join(appImageDir, appImage);
      const targetPath = join(destination, `${desktopBinaryName}.AppImage`);
      await copyFile(source, targetPath);
      await makeExecutable(targetPath);
      copied = true;
    }
  }

  const rawBinary = join(tauriTargetDir, desktopBinaryName);
  if (existsSync(rawBinary)) {
    const binaryDestination = join(destination, desktopBinaryName);
    await copyFile(rawBinary, binaryDestination);
    await makeExecutable(binaryDestination);
    copied = true;
  }

  if (!copied) {
    console.warn(
      "Skipping desktop bundle copy (no Linux Tauri artifacts were found)."
    );
  }
};

const copyMacTauriArtifacts = async (destination: string) => {
  const macBundleDir = join(tauriTargetDir, "bundle", "macos");
  if (existsSync(macBundleDir)) {
    const entries = await readdir(macBundleDir);
    const appFolder = entries.find((entry) => entry.endsWith(".app"));
    if (appFolder) {
      const source = join(macBundleDir, appFolder);
      const targetPath = join(destination, appFolder);
      await rm(targetPath, { recursive: true, force: true });
      await cp(source, targetPath, { recursive: true });
      return;
    }
  }

  const fallbackCandidates = [
    { source: desktopAppBundleName, target: desktopAppBundleName },
    { source: legacyDesktopAppBundleName, target: desktopAppBundleName },
  ];
  for (const bundle of fallbackCandidates) {
    const fallback = join(tauriTargetDir, bundle.source);
    if (existsSync(fallback)) {
      const targetPath = join(destination, bundle.target);
      await rm(targetPath, { recursive: true, force: true });
      await cp(fallback, targetPath, { recursive: true });
      return;
    }
  }

  console.warn(
    "Skipping desktop bundle copy (no macOS .app bundle was generated)."
  );
};

const copyWindowsTauriArtifacts = async (destination: string) => {
  let copied = false;
  const executableCandidates = [
    join(tauriTargetDir, `${desktopBinaryName}.exe`),
    join(tauriTargetDir, "hive.exe"),
  ];
  const executable = executableCandidates.find((entry) => existsSync(entry));
  if (executable) {
    const targetPath = join(destination, `${desktopBinaryName}.exe`);
    await copyFile(executable, targetPath);
    copied = true;
  }

  const nsisDir = join(tauriTargetDir, "bundle", "nsis");
  if (existsSync(nsisDir)) {
    const entries = await readdir(nsisDir);
    const installer = entries.find((file) =>
      file.toLowerCase().endsWith(".exe")
    );
    if (installer) {
      await copyFile(join(nsisDir, installer), join(destination, installer));
      copied = true;
    }
  }

  if (!copied) {
    console.warn(
      "Skipping desktop bundle copy (no Windows Tauri artifacts were found)."
    );
  }
};

const copyTauriBundle = async (destination: string) => {
  if (platform === "darwin") {
    await copyMacTauriArtifacts(destination);
  } else if (platform === "win32") {
    await copyWindowsTauriArtifacts(destination);
  } else {
    await copyLinuxTauriArtifacts(destination);
  }
};

const main = async () => {
  await ensureDir(releaseDir);

  await buildFrontend();
  await buildCli();
  await buildTauri();

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

  await copyTauriBundle(releaseDir);

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
