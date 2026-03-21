import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import type { AgentSession } from "@/queries/agents";
import { agentQueries } from "@/queries/agents";
import type { Cell } from "@/queries/cells";
import { cellQueries } from "@/queries/cells";

const NOTIFICATION_SOUND_PATH = "/sounds/agent-awaiting-input.wav";
const NOTIFICATION_SOUND_VOLUME = 0.2;
const AGENT_MONITOR_POLL_INTERVAL_MS = 3000;

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
  const { data: cells = [] } = useQuery({
    ...cellsQuery,
    enabled: Boolean(workspaceId),
  });
  const trackedSessionIds = useRef<Map<string, string>>(new Map());
  const lastStatuses = useRef<Map<string, string>>(new Map());
  const windowFocusedRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !workspaceId) {
      return;
    }

    const readyCells = (cells ?? []).filter((cell) => cell.status === "ready");
    const readyIds = new Set(readyCells.map((cell) => cell.id));

    for (const [cellId, sessionId] of trackedSessionIds.current.entries()) {
      if (!readyIds.has(cellId)) {
        trackedSessionIds.current.delete(cellId);
        lastStatuses.current.delete(sessionId);
      }
    }

    const syncCellSession = async (cell: Cell) => {
      const sessionQuery = agentQueries.sessionByCell(cell.id);

      try {
        const session = await queryClient.fetchQuery({
          ...sessionQuery,
          staleTime: 0,
          retry: false,
        });

        syncTrackedSession({
          cell,
          session,
          trackedSessionIds: trackedSessionIds.current,
          lastStatuses: lastStatuses.current,
          isWindowFocused: windowFocusedRef.current,
        });
      } catch {
        // ignore session fetch errors
      }
    };

    let cancelled = false;

    const syncReadyCells = async () => {
      await Promise.allSettled(
        readyCells.map(async (cell) => {
          if (cancelled) {
            return;
          }

          await syncCellSession(cell);
        })
      );
    };

    syncReadyCells().catch(ignorePromiseRejection);
    const intervalId = window.setInterval(
      syncReadyCells,
      AGENT_MONITOR_POLL_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [cells, queryClient, workspaceId]);
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

function ignorePromiseRejection() {
  return;
}

function hasDesktopBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof window.hiveDesktop?.notify === "function";
}

type SyncTrackedSessionOptions = {
  cell: Cell;
  session: AgentSession | null;
  trackedSessionIds: Map<string, string>;
  lastStatuses: Map<string, string>;
  isWindowFocused: boolean;
};

function syncTrackedSession(options: SyncTrackedSessionOptions) {
  const { cell, session, trackedSessionIds, lastStatuses, isWindowFocused } =
    options;
  const previousSessionId = trackedSessionIds.get(cell.id);

  if (!session?.id) {
    removeTrackedSession(
      cell.id,
      previousSessionId,
      trackedSessionIds,
      lastStatuses
    );
    return;
  }

  if (previousSessionId && previousSessionId !== session.id) {
    lastStatuses.delete(previousSessionId);
  }

  trackedSessionIds.set(cell.id, session.id);

  const previousStatus = lastStatuses.get(session.id);
  lastStatuses.set(session.id, session.status);

  if (
    session.status === "awaiting_input" &&
    previousStatus !== "awaiting_input"
  ) {
    dispatchAwaitingInputNotification({
      cell,
      isWindowFocused,
    });
  }
}

function removeTrackedSession(
  cellId: string,
  sessionId: string | undefined,
  trackedSessionIds: Map<string, string>,
  lastStatuses: Map<string, string>
) {
  if (!sessionId) {
    return;
  }

  trackedSessionIds.delete(cellId);
  lastStatuses.delete(sessionId);
}
