import { createFileRoute } from "@tanstack/react-router";
import {
  AudioLines,
  CircleAlert,
  CircleCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setPreferredAudioInput,
  usePreferredAudioInput,
} from "@/lib/audio-input";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

const SYSTEM_DEFAULT_VALUE = "__system_default__";
const STATUS_PANEL_CLASSES = {
  error:
    "flex gap-3 border-2 border-destructive bg-destructive/10 p-4 text-destructive",
  neutral:
    "flex gap-3 border-2 border-border bg-muted/30 p-4 text-muted-foreground",
  ready:
    "flex gap-3 border-2 border-emerald-500 bg-emerald-500/10 p-4 text-emerald-400",
} as const;

function classifyAudioInputs(devices: MediaDeviceInfo[]) {
  const labelCounts = new Map<string, number>();
  for (const device of devices) {
    if (device.kind === "audioinput" && device.label) {
      labelCounts.set(device.label, (labelCounts.get(device.label) ?? 0) + 1);
    }
  }
  return {
    ambiguousLabels: new Set(
      [...labelCounts].filter(([, count]) => count > 1).map(([label]) => label)
    ),
    devices: devices.filter(
      (device) =>
        device.kind === "audioinput" &&
        Boolean(device.label) &&
        labelCounts.get(device.label) === 1
    ),
  };
}

function SettingsRoute() {
  const preferredAudioInput = usePreferredAudioInput();
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [ambiguousAudioInputLabels, setAmbiguousAudioInputLabels] = useState<
    Set<string>
  >(new Set());
  const [deviceCount, setDeviceCount] = useState(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputs([]);
      setAmbiguousAudioInputLabels(new Set());
      setDeviceCount(0);
      setDeviceError("This browser does not support microphone discovery.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const classifiedInputs = classifyAudioInputs(inputs);
      setDeviceCount(inputs.length);
      setAudioInputs(classifiedInputs.devices);
      setAmbiguousAudioInputLabels(classifiedInputs.ambiguousLabels);
      setDeviceError(null);
    } catch (error) {
      setDeviceError(
        error instanceof Error
          ? error.message
          : "Hive could not inspect browser microphones."
      );
    }
  }, []);

  useEffect(() => {
    refreshAudioInputs().catch(() => {
      // refreshAudioInputs exposes discovery failures through route state.
    });
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      refreshAudioInputs
    );
    return () =>
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        refreshAudioInputs
      );
  }, [refreshAudioInputs]);

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDeviceError("This browser does not support microphone access.");
      return;
    }

    setIsRequestingAccess(true);
    setDeviceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await refreshAudioInputs();
    } catch (error) {
      setDeviceError(
        error instanceof Error
          ? error.message
          : "Microphone permission was not granted."
      );
    } finally {
      setIsRequestingAccess(false);
    }
  };

  const selectedDeviceAvailable = Boolean(
    preferredAudioInput &&
      audioInputs.some((device) => device.label === preferredAudioInput)
  );
  const selectedDeviceAmbiguous = Boolean(
    preferredAudioInput && ambiguousAudioInputLabels.has(preferredAudioInput)
  );
  const labelsAreVisible = audioInputs.length > 0;

  return (
    <main className="h-full overflow-y-auto p-4 sm:p-6 lg:p-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="border-primary border-l-4 pl-4">
          <p className="font-mono text-[10px] text-primary uppercase tracking-[0.32em]">
            Hive Control Plane
          </p>
          <h1 className="mt-2 font-semibold text-2xl uppercase tracking-[0.08em]">
            Settings
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
            Configure browser capabilities shared with cell viewers.
          </p>
        </header>

        <Card className="rounded-none border-2 shadow-[5px_5px_0_rgba(0,0,0,0.35)]">
          <CardHeader className="border-border border-b">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center border-2 border-primary bg-primary/10 text-primary">
                <AudioLines className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="uppercase tracking-[0.08em]">
                  Android microphone input
                </CardTitle>
                <CardDescription>
                  Hive stores the device label. Each viewer resolves its own
                  origin-specific browser device ID.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 pt-6">
            <div className="grid gap-2">
              <label
                className="font-semibold text-xs uppercase tracking-[0.18em]"
                htmlFor="audio-input"
              >
                Preferred input
              </label>
              <Select
                onValueChange={(value) =>
                  setPreferredAudioInput(
                    value === SYSTEM_DEFAULT_VALUE ? null : value
                  )
                }
                value={preferredAudioInput ?? SYSTEM_DEFAULT_VALUE}
              >
                <SelectTrigger
                  className="w-full rounded-none border-2 sm:max-w-xl"
                  id="audio-input"
                >
                  <SelectValue placeholder="Select a microphone" />
                </SelectTrigger>
                <SelectContent className="rounded-none border-2">
                  <SelectItem value={SYSTEM_DEFAULT_VALUE}>
                    System default
                  </SelectItem>
                  {audioInputs.map((device) => (
                    <SelectItem key={device.deviceId} value={device.label}>
                      {device.label}
                    </SelectItem>
                  ))}
                  {preferredAudioInput && !selectedDeviceAvailable ? (
                    <SelectItem disabled value={preferredAudioInput}>
                      {preferredAudioInput} (unavailable)
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            <AudioInputStatus
              deviceCount={deviceCount}
              error={deviceError}
              labelsAreVisible={labelsAreVisible}
              preferredAudioInput={preferredAudioInput}
              selectedDeviceAmbiguous={selectedDeviceAmbiguous}
              selectedDeviceAvailable={selectedDeviceAvailable}
            />

            <div className="flex flex-wrap gap-3 border-border border-t pt-5">
              <Button
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                disabled={isRequestingAccess}
                onClick={requestMicrophoneAccess}
                type="button"
              >
                {isRequestingAccess ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <AudioLines className="size-4" />
                )}
                Grant access and scan
              </Button>
              <Button
                className="rounded-none border-2 uppercase tracking-[0.12em]"
                onClick={refreshAudioInputs}
                type="button"
                variant="outline"
              >
                <RefreshCw className="size-4" />
                Refresh devices
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AudioInputStatus({
  deviceCount,
  error,
  labelsAreVisible,
  preferredAudioInput,
  selectedDeviceAmbiguous,
  selectedDeviceAvailable,
}: {
  deviceCount: number;
  error: string | null;
  labelsAreVisible: boolean;
  preferredAudioInput: string | null;
  selectedDeviceAmbiguous: boolean;
  selectedDeviceAvailable: boolean;
}) {
  if (error) {
    return <StatusPanel message={error} tone="error" />;
  }

  if (!preferredAudioInput) {
    return (
      <StatusPanel
        message="Android viewers will request the browser's system-default microphone."
        tone="neutral"
      />
    );
  }

  if (selectedDeviceAvailable) {
    return (
      <StatusPanel
        message={`Ready to use ${preferredAudioInput}.`}
        tone="ready"
      />
    );
  }

  if (selectedDeviceAmbiguous) {
    return (
      <StatusPanel
        message={`Multiple microphones are named "${preferredAudioInput}". Rename or disconnect one, then select the uniquely named input.`}
        tone="error"
      />
    );
  }

  if (labelsAreVisible || deviceCount === 0) {
    return (
      <StatusPanel
        message={`Configured microphone "${preferredAudioInput}" is unavailable. Select another device before recording.`}
        tone="error"
      />
    );
  }

  return (
    <StatusPanel
      message={`Grant microphone access to verify "${preferredAudioInput}" in this browser profile.`}
      tone="neutral"
    />
  );
}

function StatusPanel({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "neutral" | "ready";
}) {
  const Icon = tone === "ready" ? CircleCheck : CircleAlert;
  return (
    <div
      className={STATUS_PANEL_CLASSES[tone]}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <p className="text-sm leading-relaxed">{message}</p>
    </div>
  );
}
