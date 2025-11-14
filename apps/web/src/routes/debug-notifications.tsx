import { createFileRoute } from "@tanstack/react-router";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/debug-notifications")({
  component: DebugNotificationsRoute,
});

const NOTIFICATION_TITLE = "Synthetic Debug Notification";

type StatusTone = "idle" | "success" | "error";

type StatusState = {
  tone: StatusTone;
  detail: string;
};

const initialStatus: StatusState = {
  tone: "idle",
  detail: "Trigger a notification from the desktop shell for manual testing.",
};

const toneClassMap: Record<StatusTone, string> = {
  idle: "text-muted-foreground",
  success: "text-emerald-400",
  error: "text-destructive",
};

export const hasTauriBridge = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const candidate = window as Window & {
    __TAURI__?: unknown;
    __TAURI_IPC__?: unknown;
  };

  return Boolean(candidate.__TAURI__ ?? candidate.__TAURI_IPC__);
};

function DebugNotificationsRoute() {
  const [status, setStatus] = useState<StatusState>(initialStatus);
  const [isSending, setIsSending] = useState(false);

  const handleTrigger = useCallback(async () => {
    if (!hasTauriBridge()) {
      setStatus({
        tone: "error",
        detail:
          "Notifications are only available inside the Tauri desktop app.",
      });
      return;
    }

    setIsSending(true);
    setStatus({ tone: "idle", detail: "Requesting permission…" });

    try {
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === "granted";
      }

      if (!permissionGranted) {
        setStatus({
          tone: "error",
          detail: "Notification permission was denied.",
        });
        return;
      }

      await sendNotification({
        title: NOTIFICATION_TITLE,
        body: `Triggered at ${new Date().toLocaleTimeString()}`,
      });

      setStatus({
        tone: "success",
        detail: "Notification dispatched. Check your system tray/toast.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        detail:
          error instanceof Error
            ? error.message
            : "Unexpected error while sending notification.",
      });
    } finally {
      setIsSending(false);
    }
  }, []);

  return (
    <div className="space-y-6 rounded-xl border border-foreground/10 bg-background/80 p-6">
      <div className="space-y-2">
        <h1 className="font-semibold text-2xl uppercase tracking-wide">
          Debug Notifications
        </h1>
        <p className="text-muted-foreground text-sm">
          Tap the button below while running inside the desktop shell to
          dispatch a Tauri notification for manual testing.
        </p>
      </div>
      <Button disabled={isSending} onClick={handleTrigger}>
        {isSending ? "Sending…" : "Send Debug Notification"}
      </Button>
      <p className={`text-sm ${toneClassMap[status.tone]}`}>{status.detail}</p>
    </div>
  );
}
