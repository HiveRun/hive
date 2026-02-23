#!/usr/bin/env bun

import { repoRoot, resolveReleaseVersion } from "./release-version";

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

const main = async () => {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: bun run release:tag");
    console.log(
      "Creates an annotated release tag from the versioned desktop manifest."
    );
    return;
  }

  const versionSource = await resolveReleaseVersion();

  const tagName = `v${versionSource.version}`;
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
  console.log(`Version source: ${versionSource.source}`);
  console.log(`Push with: git push origin ${tagName}`);
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
