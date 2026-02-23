#!/usr/bin/env bun

import {
  normalizeVersion,
  readReleaseManifestVersions,
  resolveReleaseVersion,
} from "./release-version";

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const parseTagArgument = () => {
  const args = process.argv.slice(2);
  const tagFlagIndex = args.indexOf("--tag");
  if (tagFlagIndex === -1) {
    return;
  }

  const rawTag = args[tagFlagIndex + 1];
  if (!rawTag) {
    throw new Error("Missing value for --tag (expected format: vX.Y.Z)");
  }

  const normalizedTag = normalizeVersion(rawTag);
  if (!(normalizedTag && SEMVER_PATTERN.test(normalizedTag))) {
    throw new Error(`Invalid release tag: ${rawTag}`);
  }

  return {
    rawTag,
    version: normalizedTag,
  };
};

const main = async () => {
  const manifestVersions = await readReleaseManifestVersions();
  if (manifestVersions.length === 0) {
    throw new Error(
      "No valid release version found in apps/desktop-electron/package.json or package.json."
    );
  }

  const uniqueManifestVersions = new Set(
    manifestVersions.map((entry) => entry.version)
  );
  if (uniqueManifestVersions.size > 1) {
    const detail = manifestVersions
      .map((entry) => `${entry.source}: ${entry.version}`)
      .join(", ");
    throw new Error(`Release manifest versions do not match: ${detail}`);
  }

  const versionSource = await resolveReleaseVersion({
    envVersion: Bun.env.HIVE_VERSION,
  });

  const tag = parseTagArgument();
  if (tag && tag.version !== versionSource.version) {
    throw new Error(
      `Release tag ${tag.rawTag} does not match manifest version ${versionSource.version}`
    );
  }

  console.log(`Release version resolved: ${versionSource.version}`);
  console.log(`Version source: ${versionSource.source}`);
  if (tag) {
    console.log(`Tag verified: ${tag.rawTag}`);
  }
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
