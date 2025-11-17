import { useMutation } from "@tanstack/react-query";
import audioBufferToWav from "audiobuffer-to-wav";
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

export type VoiceRecorderButtonProps = {
  config?: VoiceConfig;
  disabled?: boolean;
  encodeAsWav?: boolean;
  onProcessingEnd?: () => void;
  onProcessingStart?: () => void;
  onTranscription: (text: string) => void;
};

export function VoiceRecorderButton({
  config,
  disabled,
  encodeAsWav = false,
  onProcessingEnd,
  onProcessingStart,
  onTranscription,
}: VoiceRecorderButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
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

  const ensureAudioContext = useCallback(() => {
    if (!encodeAsWav || typeof window === "undefined") {
      return null;
    }
    const contextWindow = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor =
      contextWindow.AudioContext ?? contextWindow.webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }
    return audioContextRef.current;
  }, [encodeAsWav]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const encodeRecording = useCallback(
    async (blob: Blob) => {
      if (!encodeAsWav) {
        const buffer = await blob.arrayBuffer();
        return {
          base64: arrayBufferToBase64(buffer),
          mimeType: blob.type || "audio/webm",
        } as const;
      }

      const audioContext = ensureAudioContext();
      if (!audioContext) {
        throw new Error("Audio APIs are not supported in this environment");
      }
      const buffer = await blob.arrayBuffer();
      const audioBuffer = await decodeToAudioBuffer(audioContext, buffer);
      const wavBuffer = audioBufferToWav(audioBuffer);
      return {
        base64: arrayBufferToBase64(wavBuffer),
        mimeType: "audio/wav",
      } as const;
    },
    [encodeAsWav, ensureAudioContext]
  );

  const transcribeChunks = useCallback(
    async (chunks: Blob[], mimeType?: string) => {
      setStatus("processing");
      onProcessingStart?.();
      try {
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        const { base64, mimeType: encodedMime } = await encodeRecording(blob);
        const response = await transcribeMutation.mutateAsync({
          audioBase64: base64,
          mimeType: encodedMime,
        });
        const trimmed = response.text.trim();
        if (trimmed) {
          onTranscription(trimmed);
          toast.success("Voice transcription added to message");
        } else {
          toast.info("No speech detected in recording");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to transcribe audio";
        toast.error(message);
      } finally {
        chunksRef.current = [];
        setStatus("idle");
        onProcessingEnd?.();
      }
    },
    [
      encodeRecording,
      onProcessingEnd,
      onProcessingStart,
      onTranscription,
      transcribeMutation,
    ]
  );

  const startRecording = useCallback(async () => {
    if (!canUseVoice) {
      toast.error("Voice controls unavailable in this environment");
      return;
    }

    try {
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
          toast.info("No audio captured");
          setStatus("idle");
          onProcessingEnd?.();
          return;
        }
        await transcribeChunks(chunks, recorder.mimeType);
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

      toast.error(message);
      setStatus("idle");
    }
  }, [canUseVoice, onProcessingEnd, stopStream, transcribeChunks]);

  const stopRecordingInternal = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const handleClick = useCallback(async () => {
    if (status === "processing" || disabled) {
      return;
    }

    if (status === "recording") {
      stopRecordingInternal();
      return;
    }

    await startRecording();
  }, [disabled, startRecording, status, stopRecordingInternal]);

  useEffect(
    () => () => {
      stopRecordingInternal();
      stopStream();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {
          /* ignore close errors */
        });
        audioContextRef.current = null;
      }
    },
    [stopRecordingInternal, stopStream]
  );

  return (
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

function decodeToAudioBuffer(
  audioContext: AudioContext,
  buffer: ArrayBuffer
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    audioContext.decodeAudioData(buffer.slice(0), resolve, reject);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
