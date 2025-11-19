import { useMutation } from "@tanstack/react-query";
import { Loader2, Mic, Square } from "lucide-react";
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
  onTranscription: (text: string) => void;
  workspaceId: string;
};

export function VoiceRecorderButton({
  config,
  disabled,
  encodeAsWav = false,
  onTranscription,
  workspaceId,
}: VoiceRecorderButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const transcribeMutation = useMutation(
    voiceMutations.transcribe(workspaceId)
  );

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

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
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
      const wavBuffer = audioBufferToWavBuffer(audioBuffer);
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
    stopLevelMeter();
    stopStream();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      setStatus("idle");
    }
  }, [stopLevelMeter, stopStream]);

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

  const renderButtonContent = () => {
    if (status === "recording") {
      return (
        <>
          <Square className="mr-2 h-4 w-4" />
          Stop
        </>
      );
    }

    if (status === "processing") {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing…
        </>
      );
    }

    return (
      <>
        <Mic className="mr-2 h-4 w-4" />
        Voice
      </>
    );
  };

  return (
    <div className="flex w-full flex-col items-end gap-1">
      <Button
        aria-pressed={status === "recording"}
        className="w-full border border-primary bg-transparent px-3 py-1 text-primary text-xs uppercase tracking-[0.2em] hover:bg-primary/10"
        disabled={!canUseVoice || disabled || status === "processing"}
        onClick={handleClick}
        type="button"
        variant="ghost"
      >
        {renderButtonContent()}
      </Button>
      <div className="flex w-full items-center gap-2 text-[9px] text-muted-foreground uppercase tracking-[0.2em]">
        <div className="relative h-1 w-full rounded bg-muted-foreground/20">
          <div
            className="absolute inset-y-0 left-0 rounded bg-primary transition-[opacity,width] duration-100"
            style={{ width: `${volumePercent}%`, opacity: meterOpacity }}
          />
        </div>
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

const WAV_HEADER_SIZE = 44;
const WAV_FMT_CHUNK_SIZE = 16;
const WAV_RIFF_HEADER_ADJUST = 8;
const UINT32_BYTES = 4;
const UINT16_BYTES = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const BITS_PER_BYTE = 8;
const PCM_BITS_PER_SAMPLE = PCM_BYTES_PER_SAMPLE * BITS_PER_BYTE;
const PCM_FORMAT = 1;
const PCM_POSITIVE_SCALE = 0x7f_ff;
const PCM_NEGATIVE_SCALE = 0x80_00;

function audioBufferToWavBuffer(audioBuffer: AudioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const blockAlign = numChannels * PCM_BYTES_PER_SAMPLE;
  const bufferLength = audioBuffer.length * blockAlign;
  const totalLength = WAV_HEADER_SIZE + bufferLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  let offset = 0;
  writeString(view, offset, "RIFF");
  offset += UINT32_BYTES;
  view.setUint32(
    offset,
    WAV_HEADER_SIZE - WAV_RIFF_HEADER_ADJUST + bufferLength,
    true
  );
  offset += UINT32_BYTES;
  writeString(view, offset, "WAVE");
  offset += UINT32_BYTES;
  writeString(view, offset, "fmt ");
  offset += UINT32_BYTES;
  view.setUint32(offset, WAV_FMT_CHUNK_SIZE, true);
  offset += UINT32_BYTES;
  view.setUint16(offset, PCM_FORMAT, true);
  offset += UINT16_BYTES;
  view.setUint16(offset, numChannels, true);
  offset += UINT16_BYTES;
  view.setUint32(offset, sampleRate, true);
  offset += UINT32_BYTES;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += UINT32_BYTES;
  view.setUint16(offset, blockAlign, true);
  offset += UINT16_BYTES;
  view.setUint16(offset, PCM_BITS_PER_SAMPLE, true);
  offset += UINT16_BYTES;
  writeString(view, offset, "data");
  offset += UINT32_BYTES;
  view.setUint32(offset, bufferLength, true);
  offset += UINT32_BYTES;

  const channelData = new Array<Float32Array>(numChannels);
  for (let channel = 0; channel < numChannels; channel += 1) {
    channelData[channel] = audioBuffer.getChannelData(channel);
  }

  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      const value =
        sample < 0 ? sample * PCM_NEGATIVE_SCALE : sample * PCM_POSITIVE_SCALE;
      view.setInt16(offset, value, true);
      offset += PCM_BYTES_PER_SAMPLE;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i += 1) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
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
