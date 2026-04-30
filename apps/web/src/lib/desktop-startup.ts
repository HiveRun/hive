const STARTUP_WAIT_NOTICE_MS = 120_000;
const STARTUP_POLL_INTERVAL_MS = 300;
const HEALTH_PROBE_TIMEOUT_MS = 1500;
const STARTING_PHASE_MIN_MS = 1200;

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
  | "ready";

type ElectronStartupState = NonNullable<
  NonNullable<Window["hiveDesktop"]>["startup"]
> extends {
  getState: () => Promise<infer State>;
}
  ? State
  : never;

type DesktopStartupSnapshot = {
  phase: DesktopStartupPhase;
  backendUrl?: string;
  healthUrl?: string;
  startupMode?: "starting" | "reconnecting";
  message: string;
  attempt: number;
  startedAt: number;
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

let startupPromise: Promise<void> | null = null;
let snapshot: DesktopStartupSnapshot = createInitialSnapshot();

const updateSnapshot = (next: Partial<DesktopStartupSnapshot>) => {
  snapshot = { ...snapshot, ...next };
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

const resolveConnectionMessage = (
  shouldShowStarting: boolean,
  isTakingLong: boolean
) => {
  if (shouldShowStarting) {
    return "Starting Hive daemon";
  }

  if (isTakingLong) {
    return "Still connecting to Hive";
  }

  return "Connecting to Hive";
};

const isElectronStartupReady = (state: ElectronStartupState) =>
  state.phase === "api-ready";

const isElectronStartupError = (state: ElectronStartupState) =>
  state.phase === "error";

const createElectronStartupError = (state: ElectronStartupState) =>
  new Error(state.error ?? state.message ?? "Hive daemon did not become ready");

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

export const resetDesktopStartup = () => {
  startupPromise = null;
  snapshot = createInitialSnapshot();
  window.hiveDesktop?.startup?.retry().catch(() => null);
};

export const setDesktopStartupLoadingWorkspaces = () => {
  updateSnapshot({
    phase: "loading-workspaces",
    message: "Loading workspaces",
  });
};

export const markDesktopStartupReady = () => {
  updateSnapshot({
    phase: "ready",
    message: "Hive is ready",
  });
};

export const ensureDesktopBackendReady = async () => {
  const runtimeInfo = getRuntimeInfo();
  if (!runtimeInfo || snapshot.phase === "ready") {
    return;
  }

  if (startupPromise) {
    return await startupPromise;
  }

  const electronStartup = window.hiveDesktop?.startup;
  if (electronStartup) {
    startupPromise = new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;

      const handleState = (state: ElectronStartupState) => {
        updateSnapshot({
          backendUrl: state.backendUrl,
          healthUrl: state.healthUrl,
          phase:
            state.phase === "starting-daemon"
              ? "starting-daemon"
              : "connecting",
          message: state.message,
          startedAt: state.startedAt,
        });

        if (isElectronStartupReady(state)) {
          unsubscribe?.();
          updateSnapshot({
            phase: "loading-workspaces",
            message: "Loading workspaces",
          });
          resolve();
          return;
        }

        if (isElectronStartupError(state)) {
          unsubscribe?.();
          reject(createElectronStartupError(state));
        }
      };

      electronStartup
        .getState()
        .then((state) => {
          handleState(state);
          if (isElectronStartupReady(state) || isElectronStartupError(state)) {
            return;
          }
          unsubscribe = electronStartup.subscribe(handleState);
          electronStartup.getState().then(handleState).catch(reject);
        })
        .catch(reject);
    }).catch((error) => {
      startupPromise = null;
      throw error;
    });

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

    while (true) {
      attempt += 1;
      const elapsed = Date.now() - startedAt;
      const shouldShowStarting =
        runtimeInfo.startupMode === "starting" &&
        elapsed < STARTING_PHASE_MIN_MS;
      const isTakingLong = elapsed >= STARTUP_WAIT_NOTICE_MS;

      updateSnapshot({
        attempt,
        phase: shouldShowStarting ? "starting-daemon" : "connecting",
        message: resolveConnectionMessage(shouldShowStarting, isTakingLong),
      });

      if (await probeHealth(healthUrl)) {
        updateSnapshot({
          phase: "loading-workspaces",
          message: "Loading workspaces",
        });
        return;
      }

      await sleep(STARTUP_POLL_INTERVAL_MS);
    }
  })().catch((error) => {
    startupPromise = null;
    throw error;
  });

  return await startupPromise;
};
