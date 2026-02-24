import type { StopRuntimeResult } from "./uninstall";

type Logger = (message: string) => void;

export type BackgroundStopResult = StopRuntimeResult | "stale_pid";

export const FOREGROUND_DAEMON_ERROR =
  "Detected a running Hive daemon without a managed PID file. Stop the foreground Hive process and retry uninstall.";

type ResolveUninstallStopResultOptions = {
  confirmed: boolean;
  healthcheckUrl: string;
  workspacesUrl: string;
  stopBackgroundProcess: () => BackgroundStopResult;
  probeJson: (url: string) => Promise<unknown | null>;
  logInfo: Logger;
  logError: Logger;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const isHiveHealthResponse = (value: unknown) =>
  isRecord(value) && value.status === "ok";

const isHiveWorkspacesResponse = (value: unknown) =>
  isRecord(value) && Array.isArray(value.workspaces);

export const resolveUninstallStopResult = async ({
  confirmed,
  healthcheckUrl,
  workspacesUrl,
  stopBackgroundProcess,
  probeJson,
  logInfo,
  logError,
}: ResolveUninstallStopResultOptions): Promise<StopRuntimeResult> => {
  if (!confirmed) {
    return "not_running";
  }

  const stopResult = stopBackgroundProcess();
  if (stopResult === "failed") {
    return "failed";
  }

  if (stopResult === "stopped") {
    return "stopped";
  }

  const healthPayload = await probeJson(healthcheckUrl);
  const isHiveHealth = isHiveHealthResponse(healthPayload);

  if (isHiveHealth) {
    const workspacesPayload = await probeJson(workspacesUrl);
    const isHiveWorkspaces = isHiveWorkspacesResponse(workspacesPayload);
    if (isHiveWorkspaces) {
      logError(FOREGROUND_DAEMON_ERROR);
      return "failed";
    }
  }

  if (stopResult === "stale_pid") {
    logInfo("Removed stale PID file.");
  }

  return "not_running";
};
