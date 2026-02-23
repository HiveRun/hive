#!/usr/bin/env bun

import { resolveReleaseVersion } from "./release-version";

const main = async () => {
  const versionSource = await resolveReleaseVersion({
    envVersion: Bun.env.HIVE_VERSION,
  });

  console.log(`Release version resolved: ${versionSource.version}`);
  console.log(`Version source: ${versionSource.source}`);
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
