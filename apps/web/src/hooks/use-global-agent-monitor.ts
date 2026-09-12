import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { getApiBase } from "@/lib/api-base";
import type { AgentSession } from "@/queries/agents";
import { agentQueries } from "@/queries/agents";
import type { Cell } from "@/queries/cells";
import { cellQueries } from "@/queries/cells";

const API_BASE = getApiBase();
const NOTIFICATION_SOUND_PATH = "/sounds/agent-awaiting-input.wav";
const NOTIFICATION_SOUND_VOLUME = 0.2;
const MODE_TRANSITION_LOADING_TIMEOUT_MS = 4000;

type ModeEventPayload = {
  startMode: "plan" | "build";
  currentMode: "plan" | "build";
  modeUpdatedAt?: string;
};

function resolveModeSessionUpdate(
  previous: AgentSession,
  payload: ModeEventPayload
) {
  const isPlanToBuildTransition =
    previous.currentMode === "plan" && payload.currentMode === "build";

  return {
    nextSession: {
      ...previous,
      startMode: payload.startMode,
      currentMode: payload.currentMode,
      ...(isPlanToBuildTransition ? { status: "starting" } : {}),
      ...(payload.modeUpdatedAt
        ? { modeUpdatedAt: payload.modeUpdatedAt }
        : {}),
    },
    isPlanToBuildTransition,
    fallbackStatus: previous.status,
  };
}

type PendingModeTransition = {
  timeoutId: ReturnType<typeof setTimeout>;
  sessionQueryKey: ReturnType<typeof agentQueries.sessionByCell>["queryKey"];
  fallbackStatus: string;
};

type AgentMonitor = {
  cell: Cell;
  session: AgentSession;
  sessionQueryKey: ReturnType<typeof agentQueries.sessionByCell>["queryKey"];
};

const isAgentMonitor = (
  monitor: AgentMonitor | null
): monitor is AgentMonitor => monitor !== null;

const updateSessionQuery = (
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof agentQueries.sessionByCell>["queryKey"],
  updater: (previous: AgentSession) => AgentSession
) => {
  queryClient.setQueryData(queryKey, (previous: AgentSession | null) =>
    previous ? updater(previous) : previous
  );
};

export function useGlobalAgentMonitor() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useActiveWorkspace();
  const workspaceId = activeWorkspace?.id;
  const cellsQuery = workspaceId
    ? cellQueries.all(workspaceId)
    : {
        queryKey: ["cells", "unselected"] as const,
        queryFn: async () => [] as Cell[],
      };
  const { data: cells = [], isFetched: cellsFetched } = useQuery({
    ...cellsQuery,
    enabled: Boolean(workspaceId),
  });
  const lastStatuses = useRef<Map<string, string>>(new Map());
  const pendingModeTransitions = useRef<Map<string, PendingModeTransition>>(
    new Map()
  );
  const windowFocusedRef = useRef(true);
  const readyCellsRef = useRef<Cell[]>([]);
  const cellsFetchedRef = useRef(false);
  const reloadMonitorsRef = useRef<(() => void) | null>(null);
  const clearMonitorsRef = useRef<((waitForCells: boolean) => void) | null>(
    null
  );
  const monitoredWorkspaceIdRef = useRef<string | undefined>(undefined);

  const cancelPendingModeTransition = useCallback((sessionId: string) => {
    const pendingTransition = pendingModeTransitions.current.get(sessionId);
    if (pendingTransition) {
      clearTimeout(pendingTransition.timeoutId);
      pendingModeTransitions.current.delete(sessionId);
    }
  }, []);

  useEffect(() => {
    const workspaceChanged = monitoredWorkspaceIdRef.current !== workspaceId;
    monitoredWorkspaceIdRef.current = workspaceId;
    cellsFetchedRef.current = cellsFetched;
    readyCellsRef.current = (cells ?? []).filter(
      (cell) => cell.status === "ready"
    );
    if (workspaceChanged) {
      clearMonitorsRef.current?.(Boolean(workspaceId));
    }
    reloadMonitorsRef.current?.();
  }, [cells, cellsFetched, workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let isActive = true;
    let streamConnected = false;
    let monitorLoadVersion = 0;
    let eventSource: EventSource | null = null;
    let monitorsReady = false;
    const monitors = new Map<string, AgentMonitor>();
    const pendingEvents: Array<() => void> = [];

    // Track whether the window is in focus so we can decide between desktop
    // notifications (when unfocused) and toast notifications (when focused).
    const handleFocus = () => {
      windowFocusedRef.current = true;
    };
    const handleBlur = () => {
      windowFocusedRef.current = false;
    };

    const handleVisibilityChange = () => {
      windowFocusedRef.current = !document.hidden;
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("visibilitychange", handleVisibilityChange);

    const scheduleModeTransitionReset = (
      sessionId: string,
      sessionQueryKey: ReturnType<
        typeof agentQueries.sessionByCell
      >["queryKey"],
      fallbackStatus: string
    ) => {
      cancelPendingModeTransition(sessionId);
      const timeoutId = setTimeout(() => {
        queryClient.setQueryData(
          sessionQueryKey,
          (previous: AgentSession | null) => {
            if (!previous || previous.status !== "starting") {
              return previous;
            }

            return { ...previous, status: fallbackStatus };
          }
        );
        pendingModeTransitions.current.delete(sessionId);
      }, MODE_TRANSITION_LOADING_TIMEOUT_MS);
      pendingModeTransitions.current.set(sessionId, {
        timeoutId,
        sessionQueryKey,
        fallbackStatus,
      });
    };

    const restorePendingModeTransition = (sessionId: string) => {
      const pendingTransition = pendingModeTransitions.current.get(sessionId);
      if (!pendingTransition) {
        return;
      }

      clearTimeout(pendingTransition.timeoutId);
      queryClient.setQueryData(
        pendingTransition.sessionQueryKey,
        (previous: AgentSession | null) => {
          if (!previous || previous.status !== "starting") {
            return previous;
          }

          return {
            ...previous,
            status: pendingTransition.fallbackStatus,
          };
        }
      );
      pendingModeTransitions.current.delete(sessionId);
    };

    const loadMonitor = async (cell: Cell): Promise<AgentMonitor | null> => {
      const sessionQuery = agentQueries.sessionByCell(cell.id);
      try {
        const session = await queryClient.fetchQuery({
          ...sessionQuery,
          staleTime: 0,
        });
        return session?.id
          ? { cell, session, sessionQueryKey: sessionQuery.queryKey }
          : null;
      } catch {
        const session = queryClient.getQueryData<AgentSession>(
          sessionQuery.queryKey
        );
        return session?.id
          ? { cell, session, sessionQueryKey: sessionQuery.queryKey }
          : null;
      }
    };

    const recordStatus = (monitor: AgentMonitor, status: string) => {
      const previousStatus = lastStatuses.current.get(monitor.session.id);
      lastStatuses.current.set(monitor.session.id, status);
      if (status === "awaiting_input" && previousStatus !== "awaiting_input") {
        dispatchAwaitingInputNotification({
          cell: monitor.cell,
          isWindowFocused: windowFocusedRef.current,
        });
      }
    };

    const updateMonitorStatus = (sessionId: string, status: string) => {
      const monitor = monitors.get(sessionId);
      if (!monitor) {
        return;
      }
      updateSessionQuery(queryClient, monitor.sessionQueryKey, (previous) => ({
        ...previous,
        status,
      }));
      cancelPendingModeTransition(sessionId);
      recordStatus(monitor, status);
    };

    const handleStatus = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          sessionId: string;
          status: string;
        };
        updateMonitorStatus(payload.sessionId, payload.status);
      } catch {
        // ignore malformed events
      }
    };

    const handleMode = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ModeEventPayload & {
          sessionId: string;
        };
        const monitor = monitors.get(payload.sessionId);
        if (!monitor) {
          return;
        }

        let fallbackStatus = "working";
        let isPlanToBuildTransition = false;
        updateSessionQuery(queryClient, monitor.sessionQueryKey, (previous) => {
          const next = resolveModeSessionUpdate(previous, payload);
          isPlanToBuildTransition = next.isPlanToBuildTransition;
          fallbackStatus = next.fallbackStatus;
          return next.nextSession;
        });

        if (isPlanToBuildTransition) {
          scheduleModeTransitionReset(
            payload.sessionId,
            monitor.sessionQueryKey,
            fallbackStatus
          );
          return;
        }
        restorePendingModeTransition(payload.sessionId);
      } catch {
        // ignore malformed events
      }
    };

    const handleInputRequired = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { sessionId: string };
        updateMonitorStatus(payload.sessionId, "awaiting_input");
      } catch {
        // ignore malformed events
      }
    };

    const registerMonitor = (
      monitor: AgentMonitor,
      removedSessionIds: Set<string>
    ) => {
      removedSessionIds.delete(monitor.session.id);
      monitors.set(monitor.session.id, monitor);
      recordStatus(monitor, monitor.session.status);
    };

    const replaceMonitors = (resolvedMonitors: (AgentMonitor | null)[]) => {
      const removedSessionIds = new Set(monitors.keys());
      monitors.clear();
      for (const monitor of resolvedMonitors.filter(isAgentMonitor)) {
        registerMonitor(monitor, removedSessionIds);
      }
      for (const sessionId of removedSessionIds) {
        lastStatuses.current.delete(sessionId);
        restorePendingModeTransition(sessionId);
      }

      monitorsReady = true;
      for (const applyEvent of pendingEvents.splice(0)) {
        applyEvent();
      }
    };

    const loadMonitors = async () => {
      const loadVersion = ++monitorLoadVersion;
      monitorsReady = false;
      const readyCells = readyCellsRef.current;
      const resolvedMonitors = await Promise.all(readyCells.map(loadMonitor));
      if (!isActive || loadVersion !== monitorLoadVersion) {
        return;
      }
      replaceMonitors(resolvedMonitors);
    };

    const applyWhenMonitorsReady = (applyEvent: () => void) => {
      if (monitorsReady) {
        applyEvent();
        return;
      }
      pendingEvents.push(applyEvent);
    };

    reloadMonitorsRef.current = () => {
      if (streamConnected && cellsFetchedRef.current) {
        loadMonitors().catch(() => {
          /* individual session fetch errors are ignored */
        });
      }
    };
    clearMonitorsRef.current = (waitForCells) => {
      monitorLoadVersion += 1;
      monitorsReady = !waitForCells;
      pendingEvents.splice(0);
      for (const sessionId of monitors.keys()) {
        lastStatuses.current.delete(sessionId);
        restorePendingModeTransition(sessionId);
      }
      monitors.clear();
    };

    eventSource = new EventSource(`${API_BASE}/api/agents/events`);
    eventSource.addEventListener("ready", () => {
      streamConnected = true;
      reloadMonitorsRef.current?.();
    });
    eventSource.addEventListener("status", (event) => {
      applyWhenMonitorsReady(() => handleStatus(event));
    });
    eventSource.addEventListener("mode", (event) => {
      applyWhenMonitorsReady(() => handleMode(event));
    });
    eventSource.addEventListener("input_required", (event) => {
      applyWhenMonitorsReady(() => handleInputRequired(event));
    });
    eventSource.onerror = () => {
      streamConnected = false;
      monitorsReady = false;
      for (const sessionId of monitors.keys()) {
        restorePendingModeTransition(sessionId);
      }
    };

    return () => {
      isActive = false;
      reloadMonitorsRef.current = null;
      clearMonitorsRef.current = null;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      eventSource?.close();
      lastStatuses.current.clear();
      for (const sessionId of pendingModeTransitions.current.keys()) {
        restorePendingModeTransition(sessionId);
      }
    };
  }, [cancelPendingModeTransition, queryClient]);
}

type AwaitingInputNotificationOptions = {
  cell: Cell;
  isWindowFocused: boolean;
};

function dispatchAwaitingInputNotification(
  options: AwaitingInputNotificationOptions
) {
  const { cell, isWindowFocused } = options;
  const label = cell.name || cell.id;
  const message = `${label} agent needs your response`;
  const shouldUseDesktop = hasDesktopBridge() && !isWindowFocused;

  playNotificationSound();

  const showToast = () => {
    toast.info(message);
  };

  if (shouldUseDesktop) {
    const desktop = globalThis.window?.hiveDesktop;
    if (!desktop) {
      showToast();
      return;
    }

    desktop
      .notify({
        title: "Agent Awaiting Input",
        body: message,
      })
      .then((result: { delivered: boolean }) => {
        if (result.delivered) {
          return;
        }
        showToast();
      })
      .catch(() => {
        showToast();
      });
    return;
  }

  showToast();
}

let notificationAudio: HTMLAudioElement | null = null;

function playNotificationSound() {
  if (typeof window === "undefined") {
    return;
  }

  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_SOUND_PATH);
    notificationAudio.volume = NOTIFICATION_SOUND_VOLUME;
  }

  try {
    notificationAudio.currentTime = 0;
    const playResult = notificationAudio.play();
    if (playResult instanceof Promise) {
      playResult.catch(() => {
        /* ignore autoplay restrictions */
      });
    }
  } catch {
    // Ignore audio errors
  }
}

function hasDesktopBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof window.hiveDesktop?.notify === "function";
}
