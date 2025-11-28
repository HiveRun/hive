import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type {
  AutomaticSpeechRecognitionOutput,
  AutomaticSpeechRecognitionPipeline,
  Chunk,
} from "@xenova/transformers";
import { WaveFile } from "wavefile";

const MODEL_CACHE_DIR = resolve(process.cwd(), ".synthetic/models");
const TARGET_SAMPLE_RATE = 16_000;

type TransformersModule = typeof import("@xenova/transformers");

let transformersModulePromise: Promise<TransformersModule | null> | null = null;
let localBackendError: Error | null = null;
let hasLoggedBackendFailure = false;

const ensureModelCacheDirectory = () => {
  try {
    mkdirSync(MODEL_CACHE_DIR, { recursive: true });
  } catch {
    /* ignore errors when directory exists */
  }
};

const logBackendFailure = (message: string) => {
  if (hasLoggedBackendFailure) {
    return;
  }
  hasLoggedBackendFailure = true;
  localBackendError = new Error(message);
  process.stderr.write(`${message}\n`);
};

const loadTransformersModule = () => {
  if (!transformersModulePromise) {
    transformersModulePromise = (async () => {
      try {
        ensureModelCacheDirectory();
        const mod = await import("@xenova/transformers");
        mod.env.allowLocalModels = true;
        mod.env.cacheDir = MODEL_CACHE_DIR;
        return mod;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logBackendFailure(
          `Local voice transcription disabled: ${detail}. Install ONNX Runtime libraries (libonnxruntime) or set voice.transcription.mode="remote".`
        );
        return null;
      }
    })();
  }
  return transformersModulePromise;
};

type LocalTranscriptionArgs = {
  audio: Uint8Array;
  model: string;
  language?: string;
};

type PipelineCache = Map<string, Promise<AutomaticSpeechRecognitionPipeline>>;

export type LocalTranscriptionResult = {
  text: string;
  language: string | null;
  durationInSeconds: number;
  segments: Array<{
    text: string;
    startSecond: number | null;
    endSecond: number | null;
  }>;
};

const pipelineCache: PipelineCache = new Map();

async function loadTranscriber(modelId: string) {
  const transformers = await loadTransformersModule();
  if (!transformers) {
    throw (
      localBackendError ??
      new Error(
        "Local voice transcription backend is unavailable on this system."
      )
    );
  }

  if (!pipelineCache.has(modelId)) {
    pipelineCache.set(
      modelId,
      transformers.pipeline("automatic-speech-recognition", modelId)
    );
  }

  const cached = pipelineCache.get(modelId);
  if (!cached) {
    throw new Error(`Unable to load transcription pipeline for ${modelId}`);
  }
  return cached;
}

export async function preloadLocalTranscriber(modelId: string) {
  await loadTranscriber(modelId);
}

function decodeWaveform(audioBytes: Uint8Array): Float32Array {
  const wav = new WaveFile(audioBytes);
  wav.toBitDepth("32f");
  wav.toSampleRate(TARGET_SAMPLE_RATE);

  const samples = wav.getSamples();
  let mono: Float32Array | Float64Array | number[] = samples as
    | Float32Array
    | Float64Array
    | number[];

  if (Array.isArray(samples)) {
    if (samples.length > 1) {
      const merged = samples[0];
      const channelCount = samples.length;

      for (let i = 0; i < merged.length; i += 1) {
        let sum = 0;
        for (let channel = 0; channel < channelCount; channel += 1) {
          sum += samples[channel][i];
        }
        merged[i] = sum / channelCount;
      }

      mono = merged;
    } else {
      mono = samples[0];
    }
  }

  if (mono instanceof Float32Array) {
    return mono;
  }
  if (mono instanceof Float64Array) {
    return Float32Array.from(mono);
  }
  return Float32Array.from(mono);
}

export async function transcribeLocalAudio(
  args: LocalTranscriptionArgs
): Promise<LocalTranscriptionResult> {
  const waveform = decodeWaveform(args.audio);
  const durationInSeconds = waveform.length / TARGET_SAMPLE_RATE;
  const transcriber = await loadTranscriber(args.model);
  const output = await transcriber(waveform, {
    return_timestamps: true,
    language: args.language,
  });
  const normalized = selectPrimaryOutput(output);

  return {
    text: normalized?.text ?? "",
    language: args.language ?? null,
    durationInSeconds,
    segments: mapChunks(normalized?.chunks),
  };
}

function selectPrimaryOutput(
  output: AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[]
): AutomaticSpeechRecognitionOutput {
  if (Array.isArray(output)) {
    return output[0] ?? { text: "" };
  }
  return output;
}

function mapChunks(chunks?: Chunk[]) {
  return (chunks ?? []).map((chunk) => ({
    text: chunk.text,
    startSecond: chunk.timestamp?.[0] ?? null,
    endSecond: chunk.timestamp?.[1] ?? null,
  }));
}
