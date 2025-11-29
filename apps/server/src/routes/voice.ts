import { Buffer } from "node:buffer";

import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONValue, TranscriptionModel } from "ai";
import { experimental_transcribe as transcribe } from "ai";
import { Elysia, t } from "elysia";
import { getHiveConfig } from "../config/context";
import type { VoiceConfig, VoiceTranscriptionConfig } from "../config/schema";
import {
  VoiceConfigResponseSchema,
  VoiceTranscriptionRequestSchema,
  VoiceTranscriptionResponseSchema,
} from "../schema/api";
import {
  preloadLocalTranscriber,
  transcribeLocalAudio,
} from "../voice/local-transcriber";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";

const HTTP_STATUS = {
  BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

const DEFAULT_PROVIDER_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
};

const REMOTE_PROVIDER_MODEL: Record<"openai" | "groq", string> = {
  openai: "whisper-1",
  groq: "whisper-large-v3-turbo",
};

const ErrorResponseSchema = t.Object({
  message: t.String(),
});

export async function preloadVoiceTranscriptionModels() {
  try {
    const config = await getHiveConfig();
    if (config.voice?.enabled && config.voice.transcription.mode === "local") {
      await preloadLocalTranscriber(config.voice.transcription.model);
      process.stderr.write(
        `Voice model preloaded: ${config.voice.transcription.model}\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `Failed to preload voice model: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

export const voiceRoutes = new Elysia({ prefix: "/api/voice" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/config",
    async ({ query, set, getWorkspaceContext }) => {
      try {
        const workspaceContext = await getWorkspaceContext(query.workspaceId);
        const config = await workspaceContext.loadConfig();
        return { voice: serializeVoiceConfig(config.voice) };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to load voice configuration",
        };
      }
    },
    {
      query: t.Object({ workspaceId: t.Optional(t.String()) }),
      response: {
        200: VoiceConfigResponseSchema,
        400: ErrorResponseSchema,
      },
    }
  )
  .post(
    "/transcriptions",
    async ({ body, query, set, getWorkspaceContext }) => {
      let voice: VoiceConfig | undefined;
      try {
        const workspaceIdentifier = query.workspaceId ?? body.workspaceId;
        const workspaceContext = await getWorkspaceContext(workspaceIdentifier);
        const config = await workspaceContext.loadConfig();
        voice = config.voice;
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to load voice configuration",
        };
      }

      if (!voice?.enabled) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: "Voice transcription is disabled in config" };
      }

      const audioBytes = decodeAudio(body.audioBase64);
      if (!audioBytes) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: "Audio payload is empty" };
      }

      try {
        if (voice.transcription.mode === "local") {
          const result = await transcribeLocalRecording(
            audioBytes,
            voice.transcription
          );
          return serializeTranscription(result);
        }

        const result = await transcribeRemoteRecording(
          audioBytes,
          voice.transcription
        );
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
    },
    {
      query: t.Object({ workspaceId: t.Optional(t.String()) }),
      body: VoiceTranscriptionRequestSchema,
      response: {
        200: VoiceTranscriptionResponseSchema,
        400: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    }
  );

async function transcribeLocalRecording(
  audioBytes: Uint8Array,
  transcription: Extract<VoiceTranscriptionConfig, { mode: "local" }>
) {
  const result = await transcribeLocalAudio({
    audio: audioBytes,
    model: transcription.model,
    language: transcription.language,
  });
  return result;
}

async function transcribeRemoteRecording(
  audioBytes: Uint8Array,
  transcription: Extract<VoiceTranscriptionConfig, { mode: "remote" }>
) {
  const { model, providerOptions, timeoutMs } =
    createRemoteModelFactory(transcription);
  const result = await transcribe({
    model,
    audio: audioBytes,
    providerOptions,
    abortSignal:
      typeof AbortSignal !== "undefined"
        ? AbortSignal.timeout(timeoutMs)
        : undefined,
  });

  return {
    text: result.text,
    language: result.language ?? null,
    durationInSeconds: result.durationInSeconds ?? null,
    segments: (result.segments ?? []).map((segment) => ({
      text: segment.text,
      startSecond: segment.startSecond ?? null,
      endSecond: segment.endSecond ?? null,
    })),
  };
}

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

  const modelLabel =
    transcription.mode === "local"
      ? transcription.model
      : REMOTE_PROVIDER_MODEL[transcription.provider];

  return {
    enabled: voice.enabled,
    allowBrowserRecording: voice.allowBrowserRecording,
    mode: voice.enabled ? transcription.mode : null,
    provider: voice.enabled ? providerLabel : null,
    model: voice.enabled ? modelLabel : null,
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
  const modelId = REMOTE_PROVIDER_MODEL.openai;
  return {
    model: openai.transcription(modelId),
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
  const modelId = REMOTE_PROVIDER_MODEL.groq;
  return {
    model: groq.transcription(modelId),
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
