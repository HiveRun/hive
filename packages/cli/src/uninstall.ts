import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export type StopRuntimeResult = "failed" | "not_running" | "stopped";

type Logger = (message: string) => void;

export type UninstallHiveOptions = {
  confirm: boolean;
  preserveData?: boolean;
  hiveHome: string;
  hiveBinDir?: string;
  homeDir?: string;
  xdgConfigHome?: string;
  zshCustom?: string;
  shellPath?: string;
  stopRuntime: () => StopRuntimeResult;
  closeDesktop: () => void;
  logInfo: Logger;
  logSuccess: Logger;
  logWarning: Logger;
  logError: Logger;
};

type UninstallHiveRuntimeOptions = Pick<
  UninstallHiveOptions,
  "stopRuntime" | "logInfo" | "logWarning"
>;

type UninstallHiveFileOptions = Pick<
  UninstallHiveOptions,
  "hiveHome" | "preserveData" | "logError" | "logInfo" | "logSuccess"
>;

type ShellIntegrationOptions = Pick<
  UninstallHiveOptions,
  | "hiveHome"
  | "hiveBinDir"
  | "homeDir"
  | "xdgConfigHome"
  | "zshCustom"
  | "shellPath"
>;

type ShellCleanupReport = {
  removedPathEntries: number;
  removedCompletions: number;
  refreshCommand: string | null;
};

const NEWLINE_PATTERN = /\r?\n/;

const pathLivesInDirectory = (targetPath: string, baseDirectory: string) => {
  const normalizedTarget = resolve(targetPath);
  const normalizedBase = resolve(baseDirectory);
  return (
    normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  );
};

const shouldRemoveHiveBinary = (binaryPath: string, hiveHome: string) => {
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
  logInfo,
  logWarning,
}: UninstallHiveRuntimeOptions) => {
  const stopResult = stopRuntime();
  if (stopResult === "failed") {
    logWarning(
      "Unable to confirm daemon shutdown. Continuing uninstall and removing local files."
    );
    return true;
  }
  if (stopResult === "stopped") {
    logInfo("Stopped running instance.");
  }
  return true;
};

const removeHiveHomeDirectory = ({
  hiveHome,
  preserveData,
  logError,
  logInfo,
  logSuccess,
}: UninstallHiveFileOptions) => {
  if (!existsSync(hiveHome)) {
    logInfo(`No installation directory found at ${hiveHome}.`);
    return 0;
  }

  if (preserveData) {
    const runtimeArtifacts = [
      join(hiveHome, "current"),
      join(hiveHome, "releases"),
      join(hiveHome, "bin"),
      join(hiveHome, "hive.pid"),
      join(hiveHome, "install.sh"),
    ];

    try {
      for (const artifactPath of runtimeArtifacts) {
        rmSync(artifactPath, { recursive: true, force: true });
      }
    } catch (error) {
      logError(
        `Failed to remove application files from ${hiveHome}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 1;
    }

    logSuccess(`Hive application uninstalled from ${hiveHome}.`);
    logInfo(`Preserved Hive data at ${join(hiveHome, "state")}.`);
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

const removeLinesFromFile = (filePath: string, lineToRemove: string) => {
  if (!existsSync(filePath)) {
    return false;
  }

  let source = "";
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }

  const lines = source.split(NEWLINE_PATTERN);
  const keptLines: string[] = [];
  let removed = false;

  for (const line of lines) {
    if (line === lineToRemove) {
      removed = true;
      if (keptLines.at(-1) === "# hive") {
        keptLines.pop();
      }
      continue;
    }
    keptLines.push(line);
  }

  if (!removed) {
    return false;
  }

  let nextSource = keptLines.join("\n");
  if (source.endsWith("\n") && !nextSource.endsWith("\n")) {
    nextSource = `${nextSource}\n`;
  }

  try {
    writeFileSync(filePath, nextSource, "utf8");
  } catch {
    return false;
  }

  return true;
};

const removeManagedCompletionScript = (filePath: string) => {
  if (!existsSync(filePath)) {
    return false;
  }

  let source = "";
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }

  const managedSignatures = [
    "# bash completion for hive",
    "# fish completion for hive",
    "#compdef hive",
  ];

  if (!managedSignatures.some((signature) => source.includes(signature))) {
    return false;
  }

  try {
    unlinkSync(filePath);
  } catch {
    return false;
  }

  return true;
};

const getShellIntegrationConfig = ({
  hiveHome,
  hiveBinDir,
  homeDir,
  xdgConfigHome,
  zshCustom,
  shellPath,
}: ShellIntegrationOptions) => {
  const resolvedHome = homeDir ?? homedir();
  const resolvedXdgConfig =
    xdgConfigHome ??
    process.env.XDG_CONFIG_HOME ??
    join(resolvedHome, ".config");
  const resolvedBinDir = hiveBinDir ?? join(hiveHome, "bin");
  const resolvedZshCustom = zshCustom ?? process.env.ZSH_CUSTOM;
  const resolvedShellPath = shellPath ?? process.env.SHELL;

  return {
    home: resolvedHome,
    xdgConfig: resolvedXdgConfig,
    binDir: resolvedBinDir,
    zshCustom: resolvedZshCustom,
    shellPath: resolvedShellPath,
  };
};

const getShellRefreshCommand = (shellPath: string | undefined) => {
  const shellName = basename(shellPath ?? "").toLowerCase();
  if (shellName === "zsh") {
    return "unfunction _hive 2>/dev/null; compdef -d hive 2>/dev/null; hash -r";
  }
  if (shellName === "bash") {
    return "complete -r hive 2>/dev/null; hash -r";
  }
  if (shellName === "fish") {
    return "complete -c hive -e; functions -e _hive 2>/dev/null";
  }
  return null;
};

const cleanupShellIntegrations = (
  options: ShellIntegrationOptions
): ShellCleanupReport => {
  const config = getShellIntegrationConfig(options);

  const pathLine = `export PATH=${config.binDir}:$PATH`;
  const fishPathLine = `fish_add_path ${config.binDir}`;
  const shellPathFiles = [
    join(config.home, ".zshrc"),
    join(config.home, ".zshenv"),
    join(config.xdgConfig, "zsh", ".zshrc"),
    join(config.xdgConfig, "zsh", ".zshenv"),
    join(config.home, ".bashrc"),
    join(config.home, ".bash_profile"),
    join(config.home, ".profile"),
    join(config.xdgConfig, "bash", ".bashrc"),
    join(config.xdgConfig, "bash", ".bash_profile"),
    join(config.home, ".config", "fish", "config.fish"),
  ];

  let removedPathEntries = 0;
  for (const filePath of shellPathFiles) {
    const removedExport = removeLinesFromFile(filePath, pathLine);
    const removedFish = removeLinesFromFile(filePath, fishPathLine);
    if (removedExport || removedFish) {
      removedPathEntries += 1;
    }
  }

  const zshCompletionPaths = [
    config.zshCustom ? join(config.zshCustom, "completions", "_hive") : null,
    join(config.home, ".oh-my-zsh", "custom", "completions", "_hive"),
    join(config.xdgConfig, "zsh", "completions", "_hive"),
  ].filter((value): value is string => Boolean(value));

  const completionFiles = [
    join(
      config.home,
      ".local",
      "share",
      "bash-completion",
      "completions",
      "hive"
    ),
    join(config.home, ".config", "fish", "completions", "hive.fish"),
    ...zshCompletionPaths,
  ];

  let removedCompletions = 0;
  for (const filePath of completionFiles) {
    if (removeManagedCompletionScript(filePath)) {
      removedCompletions += 1;
    }
  }

  return {
    removedPathEntries,
    removedCompletions,
    refreshCommand: getShellRefreshCommand(config.shellPath),
  };
};

const formatShellCleanupMessage = (report: ShellCleanupReport) => {
  if (report.removedPathEntries === 0 && report.removedCompletions === 0) {
    return null;
  }

  const refreshCommand = report.refreshCommand ?? "exec $SHELL -l";
  return [
    "Shell cleanup:",
    `  - removed PATH entries from ${report.removedPathEntries} shell file(s)`,
    `  - removed ${report.removedCompletions} completion script(s)`,
    `  - refresh this shell now: ${refreshCommand}`,
  ].join("\n");
};

export const uninstallHive = ({
  confirm,
  preserveData = false,
  hiveHome,
  hiveBinDir,
  homeDir,
  xdgConfigHome,
  zshCustom,
  shellPath,
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

  if (!ensureRuntimeStopped({ stopRuntime, logInfo, logWarning })) {
    return 1;
  }

  closeDesktop();

  removeManagedBinary(hiveBinDir, hiveHome, logWarning);
  const shellCleanupReport = cleanupShellIntegrations({
    hiveHome,
    hiveBinDir,
    homeDir,
    xdgConfigHome,
    zshCustom,
    shellPath,
  });

  const uninstallExitCode = removeHiveHomeDirectory({
    hiveHome,
    preserveData,
    logError,
    logInfo,
    logSuccess,
  });

  if (uninstallExitCode !== 0) {
    return uninstallExitCode;
  }

  const shellCleanupMessage = formatShellCleanupMessage(shellCleanupReport);
  if (shellCleanupMessage) {
    logInfo(shellCleanupMessage);
  }

  logInfo(
    "If you previously added Hive to PATH manually, remove stale entries from your shell profile."
  );
  return 0;
};
