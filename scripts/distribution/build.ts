#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const releaseBaseDir = join(repoRoot, "dist", "install");
const platform = process.platform;
const arch = process.arch;
const releaseName = `synthetic-${platform}-${arch}`;
const releaseDir = join(releaseBaseDir, releaseName);

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
const buildServer = () =>
  run(["bun", "run", "compile"], join(repoRoot, "apps", "server"));

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

const main = async () => {
  await ensureDir(releaseDir);

  await buildFrontend();
  await buildServer();

  const serverBinaryPath = join(repoRoot, "apps", "server", "server");
  if (!existsSync(serverBinaryPath)) {
    throw new Error("Compiled server binary not found. Did the build succeed?");
  }

  const binaryDestination = join(releaseDir, "synthetic");
  await copyFile(serverBinaryPath, binaryDestination);
  await chmod(binaryDestination, EXECUTABLE_PERMISSIONS);

  const frontendDist = join(repoRoot, "apps", "web", "dist");
  if (!existsSync(frontendDist)) {
    throw new Error(
      "Frontend dist directory missing. Run the web build first."
    );
  }

  await cp(frontendDist, join(releaseDir, "public"), { recursive: true });

  const pkg = await readRootPackage();
  const commitSha = (() => {
    try {
      return runCapture(["git", "rev-parse", "--short", "HEAD"]);
    } catch {
      return "unknown";
    }
  })();

  const manifest = {
    name: "synthetic",
    version: Bun.env.SYNTHETIC_VERSION ?? pkg.version ?? "0.0.0-dev",
    platform,
    arch,
    commit: commitSha,
    builtAt: new Date().toISOString(),
    binary: "synthetic",
    assetsDir: "public",
  } satisfies Record<string, string>;

  await writeFile(
    join(releaseDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const tarballName = `${releaseName}.tar.gz`;
  const tarballPath = join(releaseBaseDir, tarballName);

  await run(["tar", "-czf", tarballPath, "-C", releaseBaseDir, releaseName]);

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
