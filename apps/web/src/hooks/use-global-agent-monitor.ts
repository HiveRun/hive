import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AgentSession } from "@/queries/agents";
import { agentQueries } from "@/queries/agents";
import type { Construct } from "@/queries/constructs";
import { constructQueries } from "@/queries/constructs";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const NOTIFICATION_SOUND_PATH = "/sounds/agent-awaiting-input.wav";
const NOTIFICATION_SOUND_VOLUME = 0.2;

export function useGlobalAgentMonitor() {
  const queryClient = useQueryClient();
  const { data: constructs } = useQuery(constructQueries.all());
  const sessionStreams = useRef<
    Map<string, { source: EventSource; sessionId: string }>
  >(new Map());
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

    const readyConstructs = (constructs ?? []).filter(
      (construct) => construct.status === "ready"
    );
    const readyIds = new Set(readyConstructs.map((construct) => construct.id));

    for (const [constructId, stream] of sessionStreams.current.entries()) {
      if (!readyIds.has(constructId)) {
        stream.source.close();
        sessionStreams.current.delete(constructId);
        lastStatuses.current.delete(stream.sessionId);
      }
    }

    const startMonitor = async (construct: Construct) => {
      const sessionQuery = agentQueries.sessionByConstruct(construct.id);

      try {
        const session = await queryClient.ensureQueryData(sessionQuery);
        if (!session?.id) {
          return;
        }

        const currentStream = sessionStreams.current.get(construct.id);
        if (currentStream) {
          if (currentStream.sessionId === session.id) {
            return;
          }
          currentStream.source.close();
          sessionStreams.current.delete(construct.id);
        }

        const eventSource = new EventSource(
          `${API_BASE}/api/agents/sessions/${session.id}/events`
        );
        sessionStreams.current.set(construct.id, {
          source: eventSource,
          sessionId: session.id,
        });

        const handleStatus = (event: MessageEvent<string>) => {
          try {
            const payload = JSON.parse(event.data) as {
              status: string;
              error?: string;
            };

            queryClient.setQueryData(
              sessionQuery.queryKey,
              (previous: AgentSession | null) => {
                if (!previous) {
                  return previous;
                }
                return { ...previous, status: payload.status };
              }
            );

            const previousStatus = lastStatuses.current.get(session.id);
            lastStatuses.current.set(session.id, payload.status);

            if (
              payload.status === "awaiting_input" &&
              previousStatus !== "awaiting_input"
            ) {
              dispatchAwaitingInputNotification({
                construct,
                isWindowFocused: windowFocusedRef.current,
              });
            }
          } catch {
            // ignore malformed events
          }
        };

        eventSource.addEventListener("status", handleStatus);
        eventSource.onerror = () => {
          eventSource.close();
          sessionStreams.current.delete(construct.id);
          lastStatuses.current.delete(session.id);
        };
      } catch {
        // ignore session fetch errors
      }
    };

    for (const construct of readyConstructs) {
      const existingStream = sessionStreams.current.get(construct.id);
      if (existingStream?.sessionId) {
        continue;
      }
      startMonitor(construct);
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("visibilitychange", handleVisibilityChange);

      for (const stream of sessionStreams.current.values()) {
        stream.source.close();
      }
      sessionStreams.current.clear();
      lastStatuses.current.clear();
    };
  }, [constructs, queryClient]);
}

type AwaitingInputNotificationOptions = {
  construct: Construct;
  isWindowFocused: boolean;
};

function dispatchAwaitingInputNotification(
  options: AwaitingInputNotificationOptions
) {
  const { construct, isWindowFocused } = options;
  const label = construct.name || construct.id;
  const message = `${label} agent needs your response`;
  const shouldUseDesktop = hasTauriBridge() && !isWindowFocused;

  playNotificationSound();

  const showToast = () => {
    toast.info(message);
  };

  if (shouldUseDesktop) {
    import("@tauri-apps/plugin-notification")
      .then(async ({ isPermissionGranted, requestPermission }) => {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }

        if (granted) {
          const notification = new window.Notification("Agent Awaiting Input", {
            body: message,
          });
          notification.onclick = () => {
            window.focus();
          };
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

function hasTauriBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  const candidate = window as Window & {
    __TAURI__?: unknown;
    __TAURI_IPC__?: unknown;
  };

  return Boolean(candidate.__TAURI__ ?? candidate.__TAURI_IPC__);
}
