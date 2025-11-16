import { Buffer } from "node:buffer";

import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONValue, TranscriptionModel } from "ai";
import { experimental_transcribe as transcribe } from "ai";
import { Elysia, t } from "elysia";
import { getSyntheticConfig } from "../config/context";
import type { VoiceConfig, VoiceTranscriptionConfig } from "../config/schema";
import {
  VoiceConfigResponseSchema,
  VoiceTranscriptionRequestSchema,
  VoiceTranscriptionResponseSchema,
} from "../schema/api";
import { transcribeLocalAudio } from "../voice/local-transcriber";

const HTTP_STATUS = {
  BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

const DEFAULT_PROVIDER_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
};

const ErrorResponseSchema = t.Object({
  message: t.String(),
});

export const voiceRoutes = new Elysia({ prefix: "/api/voice" })
  .get(
    "/config",
    async () => {
      const config = await getSyntheticConfig();
      return { voice: serializeVoiceConfig(config.voice) };
    },
    {
      response: {
        200: VoiceConfigResponseSchema,
      },
    }
  )
  .post(
    "/transcriptions",
    async ({ body, set }) => {
      const config = await getSyntheticConfig();
      const voice = config.voice;

      if (!voice?.enabled) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: "Voice transcription is disabled in config" };
      }

      const audioBytes = decodeAudio(body.audioBase64);
      if (!audioBytes) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: "Audio payload is empty" };
      }

      if (voice.transcription.mode === "local") {
        try {
          const result = await transcribeLocalAudio({
            audio: audioBytes,
            model: voice.transcription.model,
            language: voice.transcription.language,
          });
          return serializeTranscription(result);
        } catch (error) {
          set.status = HTTP_STATUS.SERVICE_UNAVAILABLE;
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to transcribe audio",
          };
        }
      }

      try {
        const { model, providerOptions, timeoutMs } = createRemoteModelFactory(
          voice.transcription
        );
        const result = await transcribe({
          model,
          audio: audioBytes,
          providerOptions,
          abortSignal:
            typeof AbortSignal !== "undefined"
              ? AbortSignal.timeout(timeoutMs)
              : undefined,
        });

        return serializeTranscription({
          text: result.text,
          language: result.language ?? null,
          durationInSeconds: result.durationInSeconds ?? null,
          segments: (result.segments ?? []).map((segment) => ({
            text: segment.text,
            startSecond: segment.startSecond ?? null,
            endSecond: segment.endSecond ?? null,
          })),
        });
      } catch (error) {
        set.status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to transcribe audio",
        };
      }
    },
    {
      body: VoiceTranscriptionRequestSchema,
      response: {
        200: VoiceTranscriptionResponseSchema,
        400: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    }
  );

function serializeVoiceConfig(voice?: VoiceConfig) {
  if (!voice) {
    return {
      enabled: false,
      allowBrowserRecording: false,
      mode: null,
      provider: null,
      model: null,
      language: null,
    } as const;
  }

  const { transcription } = voice;
  const providerLabel =
    transcription.mode === "local"
      ? "local"
      : (transcription.provider as string | null);
  return {
    enabled: voice.enabled,
    allowBrowserRecording: voice.allowBrowserRecording,
    mode: voice.enabled ? transcription.mode : null,
    provider: voice.enabled ? providerLabel : null,
    model: voice.enabled ? transcription.model : null,
    language: transcription.language ?? null,
  } as const;
}

function decodeAudio(audioBase64: string) {
  if (!audioBase64?.trim()) {
    return null;
  }
  const buffer = Buffer.from(audioBase64, "base64");
  if (buffer.byteLength === 0) {
    return null;
  }
  return new Uint8Array(buffer);
}

type RemoteVoiceTranscriptionConfig = Extract<
  VoiceTranscriptionConfig,
  { mode: "remote" }
>;

type ProviderOptionsMap = Record<string, Record<string, JSONValue>>;

type ModelFactoryResult = {
  model: TranscriptionModel;
  providerOptions?: ProviderOptionsMap;
  timeoutMs: number;
};

function createRemoteModelFactory(
  transcription: RemoteVoiceTranscriptionConfig
): ModelFactoryResult {
  const apiKeyEnv =
    transcription.apiKeyEnv ??
    DEFAULT_PROVIDER_ENV[transcription.provider] ??
    undefined;
  const apiKey = apiKeyEnv ? Bun.env[apiKeyEnv] : undefined;

  if (!apiKey && apiKeyEnv) {
    throw new Error(
      `Missing API key for ${transcription.provider}. Set ${apiKeyEnv}.`
    );
  }

  if (transcription.provider === "openai") {
    return createOpenAIModel(transcription, apiKey);
  }

  if (transcription.provider === "groq") {
    return createGroqModel(transcription, apiKey);
  }

  throw new Error(
    `Unsupported transcription provider: ${transcription.provider}`
  );
}

function createOpenAIModel(
  transcription: RemoteVoiceTranscriptionConfig,
  apiKey?: string
): ModelFactoryResult {
  const options: Parameters<typeof createOpenAI>[0] = {};
  if (apiKey) {
    options.apiKey = apiKey;
  }
  if (transcription.baseUrl) {
    options.baseURL = transcription.baseUrl;
  }

  const openai = createOpenAI(options);
  return {
    model: openai.transcription(transcription.model),
    providerOptions: buildProviderOptions(transcription),
    timeoutMs: transcription.timeoutMs,
  } satisfies ModelFactoryResult;
}

function createGroqModel(
  transcription: RemoteVoiceTranscriptionConfig,
  apiKey?: string
): ModelFactoryResult {
  const options: Parameters<typeof createGroq>[0] = {};
  if (apiKey) {
    options.apiKey = apiKey;
  }
  if (transcription.baseUrl) {
    options.baseURL = transcription.baseUrl;
  }

  const groq = createGroq(options);
  return {
    model: groq.transcription(transcription.model),
    providerOptions: buildProviderOptions(transcription),
    timeoutMs: transcription.timeoutMs,
  } satisfies ModelFactoryResult;
}

function buildProviderOptions(
  transcription: RemoteVoiceTranscriptionConfig
): ProviderOptionsMap | undefined {
  if (!transcription.language) {
    return;
  }
  return {
    [transcription.provider]: { language: transcription.language },
  } as ProviderOptionsMap;
}

function serializeTranscription(result: {
  text?: string;
  segments?: Array<{
    text: string;
    startSecond?: number | null;
    endSecond?: number | null;
  }>;
  language?: string | null;
  durationInSeconds?: number | null;
}) {
  return {
    text: result.text ?? "",
    language: result.language ?? null,
    durationInSeconds: result.durationInSeconds ?? null,
    segments: (result.segments ?? []).map((segment) => ({
      text: segment.text,
      start: segment.startSecond ?? null,
      end: segment.endSecond ?? null,
    })),
  } as const;
}
