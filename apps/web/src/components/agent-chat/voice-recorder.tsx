import { useMutation } from "@tanstack/react-query";
import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { VoiceConfig } from "@/queries/voice";
import { voiceMutations } from "@/queries/voice";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

type RecorderStatus = "idle" | "recording" | "processing";

const STATUS_LABELS: Record<RecorderStatus, string> = {
  idle: "Push-to-talk",
  recording: "Recording… tap to stop",
  processing: "Transcribing audio…",
};

export type VoiceRecorderButtonProps = {
  config?: VoiceConfig;
  disabled?: boolean;
  onTranscription: (text: string) => void;
};

export function VoiceRecorderButton({
  config,
  disabled,
  onTranscription,
}: VoiceRecorderButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcribeMutation = useMutation(voiceMutations.transcribe);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const mediaRecorderAvailable = typeof window.MediaRecorder !== "undefined";
    const mediaDevicesAvailable = Boolean(
      typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
    );
    return mediaRecorderAvailable && mediaDevicesAvailable;
  }, []);

  const canUseVoice = Boolean(
    config?.enabled && config.allowBrowserRecording && isSupported
  );

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const stopRecordingInternal = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const transcribeChunks = useCallback(
    async (mimeType: string, chunks: Blob[]) => {
      setStatus("processing");
      try {
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        const base64 = await blobToBase64(blob);
        const response = await transcribeMutation.mutateAsync({
          audioBase64: base64,
          mimeType: blob.type,
        });
        setLastPreview(response.text);
        setErrorMessage(null);
        if (response.text.trim()) {
          onTranscription(response.text.trim());
          toast.success("Voice transcription added to message");
        } else {
          toast.info("No speech detected in recording");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to transcribe audio";
        setErrorMessage(message);
        toast.error(message);
      } finally {
        chunksRef.current = [];
        setStatus("idle");
      }
    },
    [onTranscription, transcribeMutation]
  );

  const startRecording = useCallback(async () => {
    if (!canUseVoice) {
      setErrorMessage("Voice controls unavailable in this environment");
      return;
    }

    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const options: MediaRecorderOptions = {};
      const supportedType = getSupportedMimeType();
      if (supportedType) {
        options.mimeType = supportedType;
      }
      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = async () => {
        mediaRecorderRef.current = null;
        stopStream();
        if (chunks.length === 0) {
          setStatus("idle");
          setErrorMessage("No audio captured");
          return;
        }
        await transcribeChunks(recorder.mimeType, chunks);
      };

      mediaRecorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start();
      setStatus("recording");
    } catch (error) {
      stopStream();
      mediaRecorderRef.current = null;
      chunksRef.current = [];

      let message = "Unable to access microphone";
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        message = "Microphone access denied";
      } else if (error instanceof Error) {
        message = error.message;
      }

      setErrorMessage(message);
      toast.error(message);
      setStatus("idle");
    }
  }, [canUseVoice, stopStream, transcribeChunks]);

  const handleClick = useCallback(async () => {
    if (status === "processing" || disabled) {
      return;
    }

    if (status === "recording") {
      stopRecordingInternal();
      return;
    }

    await startRecording();
  }, [status, disabled, startRecording, stopRecordingInternal]);

  useEffect(
    () => () => {
      stopRecordingInternal();
      stopStream();
    },
    [stopRecordingInternal, stopStream]
  );

  const label = (() => {
    if (errorMessage) {
      return errorMessage;
    }
    if (lastPreview && status === "idle") {
      return `Preview: ${truncateText(lastPreview)}`;
    }
    return STATUS_LABELS[status];
  })();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        aria-pressed={status === "recording"}
        className="border border-primary bg-transparent px-3 py-1 text-primary text-xs uppercase tracking-[0.2em] hover:bg-primary/10"
        disabled={!canUseVoice || disabled || status === "processing"}
        onClick={handleClick}
        type="button"
        variant="ghost"
      >
        {status === "recording" ? (
          <Square className="mr-2 h-4 w-4" />
        ) : (
          <Mic className="mr-2 h-4 w-4" />
        )}
        {status === "recording" ? "Stop" : "Voice"}
      </Button>
      <span className="text-right text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        {label}
      </span>
    </div>
  );
}

function getSupportedMimeType() {
  if (
    typeof window === "undefined" ||
    typeof window.MediaRecorder === "undefined"
  ) {
    return;
  }
  return PREFERRED_MIME_TYPES.find((type) =>
    window.MediaRecorder.isTypeSupported?.(type)
  );
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function truncateText(value: string, max = 50) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
