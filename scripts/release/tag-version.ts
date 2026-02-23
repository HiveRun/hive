#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const runCapture = (cmd: string[]) => {
  const result = Bun.spawnSync({ cmd, cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }
  return new TextDecoder().decode(result.stdout).trim();
};

const run = (cmd: string[]) => {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }
};

const isValidSemver = (version: string) => SEMVER_PATTERN.test(version);

const main = async () => {
  const packageJsonPath = new URL("../../package.json", import.meta.url);
  const packageJsonRaw = await Bun.file(packageJsonPath).text();
  const packageJson = JSON.parse(packageJsonRaw) as { version?: string };

  const version = packageJson.version;
  if (!(version && isValidSemver(version))) {
    throw new Error(
      `Root package.json version is missing or invalid: ${version ?? "<missing>"}`
    );
  }

  const tagName = `v${version}`;
  const existingTag = runCapture(["git", "tag", "--list", tagName]);
  if (existingTag) {
    throw new Error(`Tag ${tagName} already exists.`);
  }

  const workingTree = runCapture(["git", "status", "--porcelain"]);
  if (workingTree) {
    throw new Error(
      "Working tree is not clean. Commit or stash changes before tagging."
    );
  }

  run(["git", "tag", "-a", tagName, "-m", `Release ${tagName}`]);

  console.log(`Created ${tagName}.`);
  console.log(`Push with: git push origin ${tagName}`);
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
