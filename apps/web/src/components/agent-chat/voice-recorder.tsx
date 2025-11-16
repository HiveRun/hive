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

const STREAMING_TIMESLICE_MS = 1200;

type RecorderStatus = "idle" | "recording" | "processing";

export type VoiceRecorderButtonProps = {
  config?: VoiceConfig;
  disabled?: boolean;
  onStreamingError?: () => void;
  onStreamingPartial?: (text: string) => void;
  onStreamingStart?: () => void;
  onTranscription: (text: string) => void;
};

export function VoiceRecorderButton({
  config,
  disabled,
  onStreamingError,
  onStreamingPartial,
  onStreamingStart,
  onTranscription,
}: VoiceRecorderButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamingQueueRef = useRef(Promise.resolve());
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

  const handleStreamingFailure = useCallback(() => {
    onStreamingError?.();
  }, [onStreamingError]);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") {
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
  }, []);

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

  const enqueueStreamingSnapshot = useCallback(
    (snapshot: Blob) => {
      if (!onStreamingPartial) {
        return;
      }
      streamingQueueRef.current = streamingQueueRef.current
        .then(async () => {
          const base64 = await convertBlobToWavBase64(
            snapshot,
            getAudioContext
          );
          const response = await voiceMutations.transcribe.mutationFn({
            audioBase64: base64,
            mimeType: "audio/wav",
          });
          const partialText = response.text?.trim();
          if (partialText) {
            onStreamingPartial(partialText);
          }
        })
        .catch((error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to transcribe audio"
          );
          handleStreamingFailure();
        });
    },
    [getAudioContext, handleStreamingFailure, onStreamingPartial]
  );

  const transcribeRecording = useCallback(
    async (chunks: Blob[]) => {
      setStatus("processing");
      try {
        await streamingQueueRef.current.catch(() => {
          /* ignore streaming queue errors before final transcription */
        });
        const blob = new Blob(chunks, { type: "audio/webm" });
        const base64 = await convertBlobToWavBase64(blob, getAudioContext);
        const response = await transcribeMutation.mutateAsync({
          audioBase64: base64,
          mimeType: "audio/wav",
        });
        const trimmed = response.text.trim();
        if (trimmed) {
          onTranscription(trimmed);
        } else {
          toast.info("No speech detected in recording");
          onStreamingError?.();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to transcribe audio"
        );
        handleStreamingFailure();
      } finally {
        chunksRef.current = [];
        setStatus("idle");
      }
    },
    [
      getAudioContext,
      handleStreamingFailure,
      onStreamingError,
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
          if (recorder.state === "recording") {
            enqueueStreamingSnapshot(
              new Blob(chunks, { type: recorder.mimeType })
            );
          }
        }
      };

      recorder.onstop = async () => {
        mediaRecorderRef.current = null;
        stopStream();
        if (chunks.length === 0) {
          setStatus("idle");
          toast.info("No audio captured");
          onStreamingError?.();
          return;
        }
        await transcribeRecording(chunks);
      };

      mediaRecorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start(STREAMING_TIMESLICE_MS);
      setStatus("recording");
      onStreamingStart?.();
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
      handleStreamingFailure();
      setStatus("idle");
    }
  }, [
    canUseVoice,
    enqueueStreamingSnapshot,

    handleStreamingFailure,
    onStreamingError,
    onStreamingStart,
    stopStream,
    transcribeRecording,
  ]);

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

async function convertBlobToWavBase64(
  blob: Blob,
  ensureAudioContext: () => AudioContext | null
) {
  const audioContext = ensureAudioContext();
  if (!audioContext) {
    throw new Error("Audio APIs are not supported in this environment");
  }
  const buffer = await blob.arrayBuffer();
  const audioBuffer = await decodeToAudioBuffer(audioContext, buffer);
  const wavBuffer = audioBufferToWav(audioBuffer);
  return arrayBufferToBase64(wavBuffer);
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
