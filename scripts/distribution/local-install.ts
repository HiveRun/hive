#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  releaseArchivePath,
  repoRoot,
  resolveSupportedArch,
  resolveSupportedPlatform,
  run,
} from "./common";

const platform = resolveSupportedPlatform("local install");
const arch = resolveSupportedArch("local install");
const archivePath = releaseArchivePath(platform, arch);

console.log("Building installer artifacts...");
run(["bun", "run", "build:installer"], {
  failureMessage: (code) => `build:installer failed with code ${code}`,
});

if (!existsSync(archivePath)) {
  throw new Error(`Installer archive missing at ${archivePath}`);
}

const installScript = join(repoRoot, "scripts", "install.sh");
const env = {
  HIVE_INSTALL_URL: `file://${archivePath}`,
};

console.log(`Installing Hive from ${archivePath}`);
run(["bash", installScript], {
  env,
  failureMessage: (code) => `Local install failed with code ${code}`,
});

console.log("Local install complete.");
