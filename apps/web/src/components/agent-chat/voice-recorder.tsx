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

const MICROPHONE_FFT_SIZE = 512;
const PCM_MIDPOINT = 128;
const VOLUME_MULTIPLIER = 2;
const MAX_PERCENT = 100;
const ACTIVE_OPACITY = 1;
const INACTIVE_OPACITY = 0.2;
const BASE64_CHUNK_SIZE = 0x80_00;

export type RecorderStatus = "idle" | "recording" | "processing";

export type VoiceRecorderButtonProps = {
  config?: VoiceConfig;
  disabled?: boolean;
  encodeAsWav?: boolean;
  onStatusChange?: (status: RecorderStatus) => void;
  onTranscription: (text: string) => void;
};

export function VoiceRecorderButton({
  config,
  disabled,
  encodeAsWav = false,
  onStatusChange,
  onTranscription,
}: VoiceRecorderButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
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
    const context = audioContextRef.current;
    if (context?.state === "suspended") {
      context.resume().catch(() => {
        /* ignore resume errors */
      });
    }
    return context;
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    setVolumeLevel(0);
  }, []);

  const startLevelMeter = useCallback(
    (stream: MediaStream) => {
      const audioContext = ensureAudioContext();
      if (!audioContext) {
        return;
      }
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = MICROPHONE_FFT_SIZE;
      source.connect(analyser);
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);

      const update = () => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const sample of data) {
          const value = sample - PCM_MIDPOINT;
          sumSquares += value * value;
        }
        const rms = Math.sqrt(sumSquares / data.length) / PCM_MIDPOINT;
        setVolumeLevel(rms);
        animationFrameRef.current = requestAnimationFrame(update);
      };

      update();
    },
    [ensureAudioContext]
  );

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
      }
    },
    [encodeRecording, onTranscription, transcribeMutation]
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
        stopLevelMeter();
        stopStream();
        if (chunks.length === 0) {
          toast.info("No audio captured");
          setStatus("idle");
          return;
        }
        await transcribeChunks(chunks, recorder.mimeType);
      };

      mediaRecorderRef.current = recorder;
      chunksRef.current = chunks;
      recorder.start();
      startLevelMeter(stream);
      setStatus("recording");
    } catch (error) {
      stopLevelMeter();
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
  }, [
    canUseVoice,
    startLevelMeter,
    stopLevelMeter,
    stopStream,
    transcribeChunks,
  ]);

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
      stopLevelMeter();
      stopStream();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {
          /* ignore close errors */
        });
        audioContextRef.current = null;
      }
    },
    [stopLevelMeter, stopRecordingInternal, stopStream]
  );

  const volumePercent =
    Math.min(volumeLevel * VOLUME_MULTIPLIER, 1) * MAX_PERCENT;
  const meterOpacity =
    status === "recording" ? ACTIVE_OPACITY : INACTIVE_OPACITY;
  const statusLabel = useMemo(() => {
    if (status === "recording") {
      return "Listening";
    }
    if (status === "processing") {
      return "Processing";
    }
    return "";
  }, [status]);

  return (
    <div className="flex w-full flex-col items-end gap-1">
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
      <div className="flex w-full items-center gap-2 text-[9px] text-muted-foreground uppercase tracking-[0.2em]">
        <div className="relative h-1 w-20 rounded bg-muted-foreground/20">
          <div
            className="absolute inset-y-0 left-0 rounded bg-primary transition-[opacity,width] duration-100"
            style={{ width: `${volumePercent}%`, opacity: meterOpacity }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground">{statusLabel}</span>
      </div>
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
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
