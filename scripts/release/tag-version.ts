#!/usr/bin/env bun

import { runGit, runMain } from "./common";
import { resolveReleaseVersion } from "./release-version";

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
  const existingTag = runGit(["git", "tag", "--list", tagName], {
    capture: true,
  });
  if (existingTag) {
    throw new Error(`Tag ${tagName} already exists.`);
  }

  const workingTree = runGit(["git", "status", "--porcelain"], {
    capture: true,
  });
  if (workingTree) {
    throw new Error(
      "Working tree is not clean. Commit or stash changes before tagging."
    );
  }

  runGit(["git", "tag", "-a", tagName, "-m", `Release ${tagName}`]);

  console.log(`Created ${tagName}.`);
  console.log(`Version source: ${versionSource.source}`);
  console.log(`Push with: git push origin ${tagName}`);
};

await runMain(main);
