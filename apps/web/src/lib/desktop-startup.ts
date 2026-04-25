const STARTUP_TIMEOUT_MS = 120_000;
const STARTUP_POLL_INTERVAL_MS = 300;
const HEALTH_PROBE_TIMEOUT_MS = 1500;
const STARTING_PHASE_MIN_MS = 1200;
const MS_PER_SECOND = 1000;

const sleep = async (ms: number) =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const getRuntimeInfo = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.hiveDesktop?.runtimeInfo ?? null;
};

export type DesktopStartupPhase =
  | "starting-daemon"
  | "connecting"
  | "loading-workspaces"
  | "ready"
  | "error";

export type DesktopStartupSnapshot = {
  phase: DesktopStartupPhase;
  backendUrl?: string;
  healthUrl?: string;
  startupMode?: "starting" | "reconnecting";
  message: string;
  attempt: number;
  startedAt: number;
  error?: string;
};

function createInitialSnapshot(): DesktopStartupSnapshot {
  const runtimeInfo = getRuntimeInfo();
  const startupMode = runtimeInfo?.startupMode ?? "starting";

  return {
    phase: startupMode === "reconnecting" ? "connecting" : "starting-daemon",
    backendUrl: runtimeInfo?.backendUrl,
    healthUrl: runtimeInfo?.healthUrl,
    startupMode,
    message:
      startupMode === "reconnecting"
        ? "Reconnecting to Hive"
        : "Starting Hive daemon",
    attempt: 0,
    startedAt: Date.now(),
  };
}

const listeners = new Set<() => void>();
let startupPromise: Promise<void> | null = null;
let snapshot: DesktopStartupSnapshot = createInitialSnapshot();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const updateSnapshot = (next: Partial<DesktopStartupSnapshot>) => {
  snapshot = { ...snapshot, ...next };
  notify();
};

const resolveHealthUrl = (
  runtimeInfo: NonNullable<ReturnType<typeof getRuntimeInfo>>
) => {
  if (runtimeInfo.healthUrl) {
    return runtimeInfo.healthUrl;
  }

  return `${trimTrailingSlash(runtimeInfo.backendUrl)}/health`;
};

const isHiveHealthPayload = (payload: unknown) => {
  if (!(payload && typeof payload === "object")) {
    return false;
  }

  const value = payload as { service?: unknown; status?: unknown };
  return value.service === "hive" && value.status === "ok";
};

const probeHealth = async (healthUrl: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    return isHiveHealthPayload(await response.json());
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const isDesktopRuntime = () => Boolean(getRuntimeInfo());

export const getDesktopStartupSnapshot = () => snapshot;

export const subscribeDesktopStartup = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const resetDesktopStartup = () => {
  startupPromise = null;
  snapshot = createInitialSnapshot();
  notify();
};

export const setDesktopStartupLoadingWorkspaces = () => {
  updateSnapshot({
    phase: "loading-workspaces",
    message: "Loading workspaces",
    error: undefined,
  });
};

export const markDesktopStartupReady = () => {
  updateSnapshot({
    phase: "ready",
    message: "Hive is ready",
    error: undefined,
  });
};

export const setDesktopStartupError = (message: string) => {
  updateSnapshot({
    phase: "error",
    message: "Hive did not become ready",
    error: message,
  });
};

export const isDesktopStartupFailure = (error: unknown) =>
  error instanceof Error && error.message.startsWith("Desktop startup failed:");

export const ensureDesktopBackendReady = async () => {
  const runtimeInfo = getRuntimeInfo();
  if (!runtimeInfo || snapshot.phase === "ready") {
    return;
  }

  if (startupPromise) {
    return await startupPromise;
  }

  startupPromise = (async () => {
    const startedAt = Date.now();
    const healthUrl = resolveHealthUrl(runtimeInfo);
    let attempt = 0;

    updateSnapshot({
      backendUrl: runtimeInfo.backendUrl,
      healthUrl,
      startupMode: runtimeInfo.startupMode,
      startedAt,
    });

    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
      attempt += 1;
      const elapsed = Date.now() - startedAt;
      const shouldShowStarting =
        runtimeInfo.startupMode === "starting" &&
        elapsed < STARTING_PHASE_MIN_MS;

      updateSnapshot({
        attempt,
        phase: shouldShowStarting ? "starting-daemon" : "connecting",
        message: shouldShowStarting
          ? "Starting Hive daemon"
          : "Connecting to Hive",
        error: undefined,
      });

      if (await probeHealth(healthUrl)) {
        updateSnapshot({
          phase: "loading-workspaces",
          message: "Loading workspaces",
          error: undefined,
        });
        return;
      }

      await sleep(STARTUP_POLL_INTERVAL_MS);
    }

    const message = `Desktop startup failed: Hive did not respond at ${healthUrl} within ${Math.round(
      STARTUP_TIMEOUT_MS / MS_PER_SECOND
    )} seconds.`;
    setDesktopStartupError(message);
    throw new Error(message);
  })().catch((error) => {
    startupPromise = null;
    throw error;
  });

  return await startupPromise;
};
