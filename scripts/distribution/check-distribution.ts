#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repoRoot as distributionRoot,
  releaseArchivePath as getReleaseArchivePath,
  resolveSupportedArch as getSupportedArch,
  resolveSupportedPlatform as getSupportedPlatform,
  run as runDistributionCommand,
} from "./common";

const platform = getSupportedPlatform("distribution check");
const arch = getSupportedArch("distribution check");
const releaseArchive = getReleaseArchivePath(platform, arch);

const ensureDesktopArtifact = (releaseDir: string) => {
  const candidates =
    platform === "darwin"
      ? ["Hive Desktop.app", "hive-desktop", "hive-electron"]
      : [
          "hive-desktop.AppImage",
          "hive-desktop",
          "hive-electron.AppImage",
          "hive-electron",
        ];

  const found = candidates.some((candidate) =>
    existsSync(join(releaseDir, candidate))
  );

  if (!found) {
    throw new Error(
      `Desktop artifact missing in installed release. Checked: ${candidates.join(
        ", "
      )}`
    );
  }
};

const ensureAndroidViewerArtifacts = (releaseDir: string) => {
  const viewerBinary = join(
    releaseDir,
    platform === "win32"
      ? "hive-android-viewer-server.exe"
      : "hive-android-viewer-server"
  );
  const assetsDirectory = join(releaseDir, "android-runtime", "stream-droid");
  const requiredPaths = [
    viewerBinary,
    join(assetsDirectory, "emulator_controller.proto"),
    join(assetsDirectory, "public", "app.css"),
    join(assetsDirectory, "public", "client.js"),
    join(assetsDirectory, "public", "index.html"),
  ];
  const missing = requiredPaths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      `Android viewer artifacts missing from installed release: ${missing.join(", ")}`
    );
  }
  return { assetsDirectory, viewerBinary };
};

console.log("Building installer artifacts...");
runDistributionCommand(["bun", "run", "build:installer"]);

if (!existsSync(releaseArchive)) {
  throw new Error(`Installer archive missing at ${releaseArchive}`);
}

const sandboxRoot = await mkdtemp(join(tmpdir(), "hive-distribution-check-"));

try {
  const hiveHome = join(sandboxRoot, "hive-home");
  const hiveBinDir = join(hiveHome, "bin");
  const installEnv = {
    HIVE_HOME: hiveHome,
    HIVE_BIN_DIR: hiveBinDir,
    HIVE_INSTALL_URL: `file://${releaseArchive}`,
    HIVE_SKIP_OPENCODE_INSTALL: "1",
    PATH: `${hiveBinDir}:${process.env.PATH ?? ""}`,
  };

  console.log("Running installer smoke check in isolated sandbox...");
  runDistributionCommand(
    ["bash", join(distributionRoot, "scripts", "install.sh")],
    { env: installEnv }
  );

  const installedBinary = join(hiveBinDir, "hive");
  if (!existsSync(installedBinary)) {
    throw new Error(`Installed hive binary missing at ${installedBinary}`);
  }

  console.log("Validating installed CLI binary...");
  runDistributionCommand([installedBinary, "info"], { env: installEnv });

  const currentRelease = join(hiveHome, "current");
  ensureDesktopArtifact(currentRelease);
  const androidViewer = ensureAndroidViewerArtifacts(currentRelease);

  console.log("Validating installed Android viewer binary...");
  runDistributionCommand([androidViewer.viewerBinary, "--help"], {
    env: {
      ...installEnv,
      HIVE_ANDROID_EMULATOR_PROTO_PATH: join(
        androidViewer.assetsDirectory,
        "emulator_controller.proto"
      ),
      HIVE_ANDROID_STREAM_DROID_PUBLIC_DIR: join(
        androidViewer.assetsDirectory,
        "public"
      ),
    },
  });

  console.log("Distribution check passed.");
} finally {
  await rm(sandboxRoot, { recursive: true, force: true });
}
