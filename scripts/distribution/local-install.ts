#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const platform = (() => {
  const raw = process.platform;
  if (raw === "linux") {
    return "linux";
  }
  if (raw === "darwin") {
    return "darwin";
  }
  throw new Error(`Unsupported platform for local install: ${raw}`);
})();

const arch = (() => {
  const raw = process.arch;
  if (raw === "x64") {
    return "x64";
  }
  if (raw === "arm64") {
    return "arm64";
  }
  throw new Error(`Unsupported architecture for local install: ${raw}`);
})();

const archiveName = `hive-${platform}-${arch}.tar.gz`;
const archivePath = join(repoRoot, "dist", "install", archiveName);

console.log("Building installer artifacts...");
const buildResult = Bun.spawnSync({
  cmd: ["bun", "run", "build:installer"],
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});

if (buildResult.exitCode !== 0) {
  throw new Error(`build:installer failed with code ${buildResult.exitCode}`);
}

if (!existsSync(archivePath)) {
  throw new Error(`Installer archive missing at ${archivePath}`);
}

const installScript = join(repoRoot, "scripts", "install.sh");
const env = {
  ...process.env,
  HIVE_INSTALL_URL: `file://${archivePath}`,
};

console.log(`Installing Hive from ${archivePath}`);
const result = Bun.spawnSync({
  cmd: ["bash", installScript],
  cwd: repoRoot,
  env,
  stdout: "inherit",
  stderr: "inherit",
});

if (result.exitCode !== 0) {
  throw new Error(`Local install failed with code ${result.exitCode}`);
}

console.log("Local install complete.");
