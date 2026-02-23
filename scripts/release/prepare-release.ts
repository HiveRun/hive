#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import { resolveReleaseVersion } from "./release-version";

const rootManifestPath = fileURLToPath(
  new URL("../../package.json", import.meta.url)
);
const desktopManifestPath = fileURLToPath(
  new URL("../../apps/desktop-electron/package.json", import.meta.url)
);

type BumpType = "major" | "minor" | "patch";

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SEMVER_CORE_TRIPLET_PATTERN = /^(\d+)\.(\d+)\.(\d+)/;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const readFlagValue = (flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) {
      return;
    }
    return args[index + 1];
  };

  const bump = readFlagValue("--bump");
  const version = readFlagValue("--version");
  return {
    bump,
    version,
  };
};

const assertSemver = (value: string, source: string) => {
  if (!SEMVER_PATTERN.test(value)) {
    throw new Error(`${source} is not valid semver: ${value}`);
  }
};

const parseSemverTriplet = (value: string) => {
  const match = SEMVER_CORE_TRIPLET_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid semver core: ${value}`);
  }

  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
};

const compareSemver = (a: string, b: string) => {
  const left = parseSemverTriplet(a);
  const right = parseSemverTriplet(b);

  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
};

const bumpVersion = (current: string, bump: BumpType) => {
  const parsed = parseSemverTriplet(current);
  if (bump === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
};

const updateManifestVersion = async (
  manifestPath: string,
  nextVersion: string
) => {
  const manifestRaw = await Bun.file(manifestPath).text();
  const manifest = JSON.parse(manifestRaw) as {
    version?: string;
    [key: string]: unknown;
  };

  manifest.version = nextVersion;
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const writeOutputs = (nextVersion: string) => {
  const outputPath = Bun.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const tag = `v${nextVersion}`;
  const lines = [`version=${nextVersion}`, `tag=${tag}`];
  return Bun.write(outputPath, `${lines.join("\n")}\n`);
};

const main = async () => {
  const { bump, version } = parseArgs();
  const releaseVersion = await resolveReleaseVersion();
  const currentVersion = releaseVersion.version;

  if (version && bump) {
    throw new Error("Provide either --version or --bump, not both.");
  }

  if (!(version || bump)) {
    throw new Error("Missing release input. Provide --bump or --version.");
  }

  let nextVersion: string;
  if (version) {
    assertSemver(version, "--version");
    nextVersion = version;
  } else {
    if (!(bump === "major" || bump === "minor" || bump === "patch")) {
      throw new Error("--bump must be one of: major, minor, patch");
    }
    nextVersion = bumpVersion(currentVersion, bump);
  }

  if (compareSemver(nextVersion, currentVersion) <= 0) {
    throw new Error(
      `Next version (${nextVersion}) must be greater than current version (${currentVersion}).`
    );
  }

  await updateManifestVersion(rootManifestPath, nextVersion);
  await updateManifestVersion(desktopManifestPath, nextVersion);
  await writeOutputs(nextVersion);

  console.log(`Prepared release version: ${nextVersion}`);
  console.log(`Previous version: ${currentVersion}`);
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
