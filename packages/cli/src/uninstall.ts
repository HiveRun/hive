import {
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export type StopRuntimeResult = "failed" | "not_running" | "stopped";

type Logger = (message: string) => void;

export type UninstallHiveOptions = {
  confirm: boolean;
  hiveHome: string;
  hiveBinDir?: string;
  stopRuntime: () => StopRuntimeResult;
  closeDesktop: () => void;
  logInfo: Logger;
  logSuccess: Logger;
  logWarning: Logger;
  logError: Logger;
};

type UninstallHiveRuntimeOptions = Pick<
  UninstallHiveOptions,
  "stopRuntime" | "logError" | "logInfo"
>;

type UninstallHiveFileOptions = Pick<
  UninstallHiveOptions,
  "hiveHome" | "logError" | "logInfo" | "logSuccess"
>;

const pathLivesInDirectory = (targetPath: string, baseDirectory: string) => {
  const normalizedTarget = resolve(targetPath);
  const normalizedBase = resolve(baseDirectory);
  return (
    normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  );
};

const shouldRemoveHiveBinary = (binaryPath: string, hiveHome: string) => {
  if (!existsSync(binaryPath)) {
    return false;
  }

  try {
    const stats = lstatSync(binaryPath);
    if (stats.isSymbolicLink()) {
      const linkTarget = readlinkSync(binaryPath);
      const resolvedTarget = resolve(dirname(binaryPath), linkTarget);
      return pathLivesInDirectory(resolvedTarget, hiveHome);
    }

    const resolvedBinary = realpathSync(binaryPath);
    return pathLivesInDirectory(resolvedBinary, hiveHome);
  } catch {
    return false;
  }
};

const ensureRuntimeStopped = ({
  stopRuntime,
  logError,
  logInfo,
}: UninstallHiveRuntimeOptions) => {
  const stopResult = stopRuntime();
  if (stopResult === "failed") {
    logError("Unable to stop the running instance. Aborting uninstall.");
    return false;
  }
  if (stopResult === "stopped") {
    logInfo("Stopped running instance.");
  }
  return true;
};

const removeHiveHomeDirectory = ({
  hiveHome,
  logError,
  logInfo,
  logSuccess,
}: UninstallHiveFileOptions) => {
  if (!existsSync(hiveHome)) {
    logInfo(`No installation directory found at ${hiveHome}.`);
    return 0;
  }

  try {
    rmSync(hiveHome, { recursive: true, force: true });
  } catch (error) {
    logError(
      `Failed to remove ${hiveHome}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return 1;
  }

  logSuccess(`Hive uninstalled from ${hiveHome}.`);
  logInfo(
    "If you previously added Hive to PATH manually, remove stale entries from your shell profile."
  );
  return 0;
};

const removeManagedBinary = (
  hiveBinDir: string | undefined,
  hiveHome: string,
  logWarning: Logger
) => {
  if (!hiveBinDir) {
    return;
  }

  const binaryPath = join(hiveBinDir, "hive");
  if (!shouldRemoveHiveBinary(binaryPath, hiveHome)) {
    return;
  }

  try {
    unlinkSync(binaryPath);
  } catch (error) {
    logWarning(
      `Unable to remove binary symlink ${binaryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export const uninstallHive = ({
  confirm,
  hiveHome,
  hiveBinDir,
  stopRuntime,
  closeDesktop,
  logInfo,
  logSuccess,
  logWarning,
  logError,
}: UninstallHiveOptions) => {
  if (!confirm) {
    logError(
      "Uninstall aborted. Re-run with --yes to remove your Hive installation."
    );
    return 1;
  }

  if (!ensureRuntimeStopped({ stopRuntime, logError, logInfo })) {
    return 1;
  }

  closeDesktop();

  removeManagedBinary(hiveBinDir, hiveHome, logWarning);
  return removeHiveHomeDirectory({ hiveHome, logError, logInfo, logSuccess });
};
