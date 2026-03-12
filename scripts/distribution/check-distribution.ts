#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const platform = (() => {
  const raw = process.platform;
  if (raw === "linux" || raw === "darwin") {
    return raw;
  }
  throw new Error(`Unsupported platform for distribution check: ${raw}`);
})();

const arch = (() => {
  const raw = process.arch;
  if (raw === "x64" || raw === "arm64") {
    return raw;
  }
  throw new Error(`Unsupported architecture for distribution check: ${raw}`);
})();

const releaseArchive = join(
  repoRoot,
  "dist",
  "install",
  `hive-${platform}-${arch}.tar.gz`
);
const DISTRIBUTION_CHECK_PORT = "4330";
const HTTP_WAIT_TIMEOUT_MS = 20_000;
const HTTP_WAIT_INTERVAL_MS = 500;

const run = (cmd: string[], env?: Record<string, string>) => {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }
};

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

const readStdout = (result: Bun.SyncSubprocess) =>
  new TextDecoder().decode(result.stdout).trim();

const runCapture = (cmd: string[], env?: Record<string, string>) => {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env: env ? { ...process.env, ...env } : process.env,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }

  return readStdout(result);
};

const waitForHttp = async (url: string, timeoutMs = HTTP_WAIT_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      /* retry */
    }

    await Bun.sleep(HTTP_WAIT_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

console.log("Building installer artifacts...");
run(["bun", "run", "build:installer"]);

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
  run(["bash", join(repoRoot, "scripts", "install.sh")], installEnv);

  const installedBinary = join(hiveBinDir, "hive");
  if (!existsSync(installedBinary)) {
    throw new Error(`Installed hive binary missing at ${installedBinary}`);
  }

  console.log("Validating installed CLI binary...");
  run([installedBinary, "info"], installEnv);

  const currentRelease = join(hiveHome, "current");
  ensureDesktopArtifact(currentRelease);

  console.log("Starting installed Hive release...");
  run([installedBinary], { ...installEnv, PORT: DISTRIBUTION_CHECK_PORT });

  const healthBody = await waitForHttp(
    `http://localhost:${DISTRIBUTION_CHECK_PORT}/health`
  );
  if (healthBody.trim() !== '{"status":"ok"}') {
    throw new Error(`Unexpected health payload: ${healthBody}`);
  }

  const rootHtml = await waitForHttp(
    `http://localhost:${DISTRIBUTION_CHECK_PORT}/`
  );
  if (!rootHtml.includes('<div id="root"></div>')) {
    throw new Error(
      "Installed Hive root page did not serve the bundled SPA shell"
    );
  }

  const infoOutput = runCapture([installedBinary, "info"], {
    ...installEnv,
    PORT: DISTRIBUTION_CHECK_PORT,
  });
  if (!infoOutput.includes("Running (PID")) {
    throw new Error(
      `Installed Hive info did not report a running daemon:\n${infoOutput}`
    );
  }

  run([installedBinary, "stop"], {
    ...installEnv,
    PORT: DISTRIBUTION_CHECK_PORT,
  });

  console.log("Distribution check passed.");
} finally {
  await rm(sandboxRoot, { recursive: true, force: true });
}
